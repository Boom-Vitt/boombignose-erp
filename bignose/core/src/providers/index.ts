import type { Provider, ProviderConfig } from '../types.ts';
import { anthropic } from './anthropic.ts';
import { openai } from './openai.ts';
import { defaultRetry, withRetry } from './retry.ts';
import type { RetryOptions } from './retry.ts';
export function createProvider(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch, retry: Partial<RetryOptions> = {}): Provider {
  const inner = cfg.kind === 'anthropic' ? anthropic(cfg, apiKey, fetchImpl) : openai(cfg, apiKey, fetchImpl);
  const opts = { ...defaultRetry, ...retry };
  return { kind: inner.kind, stream: req => withRetry(() => inner.stream(req), req.signal, opts) };
}
