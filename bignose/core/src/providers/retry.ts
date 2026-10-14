import type { ProviderEvent } from '../types.ts';
import { ProviderError } from './errors.ts';

export interface RetryOptions {
  retries: number;     // extra attempts after the first
  baseMs: number;      // first backoff; doubles each time
  maxMs: number;       // longest single wait; a longer Retry-After fails at once
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

const sleep: RetryOptions['sleep'] = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) return reject(signal.reason);
  const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); };
  const abort = () => { done(); reject(signal!.reason); };
  const timer = setTimeout(() => { done(); resolve(); }, ms);
  signal?.addEventListener('abort', abort, { once: true });
});
export const defaultRetry: RetryOptions = { retries: 3, baseMs: 500, maxMs: 30_000, sleep };

/** Run `attempt` again after a transient failure, but only while it has produced no event: output already streamed is never replayed. */
export async function* withRetry(attempt: () => AsyncIterable<ProviderEvent>, signal: AbortSignal | undefined, opts: RetryOptions): AsyncGenerator<ProviderEvent> {
  for (let n = 0; ; n++) {
    let started = false;
    try {
      for await (const event of attempt()) { started = true; yield event; }
      return;
    } catch (error) {
      if (started || signal?.aborted || n >= opts.retries || !(error instanceof ProviderError) || !error.retryable) throw error;
      const wait = error.retryAfterMs ?? opts.baseMs * 2 ** n;
      if (wait > opts.maxMs) throw error;
      await opts.sleep(wait, signal);
    }
  }
}
