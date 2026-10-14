// Server-sent events: a pure frame parser, a stream reader and a reconnecting loop. No DOM.

/** Incremental SSE parser: feed text chunks, get the `data` payload of every completed frame. */
export class SseParser {
  private buf = '';
  private data: string[] = [];
  private started = false;

  push(chunk: string): string[] {
    if (!this.started && chunk) {
      this.started = true;
      if (chunk.charCodeAt(0) === 0xfeff) chunk = chunk.slice(1); // BOM
    }
    this.buf += chunk;
    const out: string[] = [];
    let start = 0;
    const eol = /[\r\n]/g;
    for (;;) {
      eol.lastIndex = start;
      const m = eol.exec(this.buf);
      if (!m) break;
      const i = m.index;
      if (this.buf[i] === '\r' && i === this.buf.length - 1) break; // maybe half of CRLF: wait for more
      const line = this.buf.slice(start, i);
      start = this.buf[i] === '\r' && this.buf[i + 1] === '\n' ? i + 2 : i + 1;
      if (line === '') {
        if (this.data.length) out.push(this.data.join('\n'));
        this.data = [];
      } else if (!line.startsWith(':')) {
        const c = line.indexOf(':');
        const field = c < 0 ? line : line.slice(0, c);
        let value = c < 0 ? '' : line.slice(c + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') this.data.push(value);
      }
    }
    this.buf = this.buf.slice(start);
    return out;
  }
}

/** Yields the data payload of every frame in a response body. */
export async function* sseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      yield* parser.push(decoder.decode(value, { stream: true }));
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
}

export interface EventHandlers {
  onData(data: string): void;
  onState(connected: boolean): void;
}

function sleepUnlessAborted(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
  });
}

/** Opens the stream, reports every frame, and reconnects with backoff (1 s doubling to 15 s) until aborted. */
export async function streamEvents(
  open: (signal: AbortSignal) => Promise<Response>,
  handlers: EventHandlers,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = sleepUnlessAborted,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    try {
      const res = await open(signal);
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
      failures = 0;
      handlers.onState(true);
      for await (const data of sseData(res.body)) handlers.onData(data);
    } catch {
      // fall through to the reconnect path
    }
    if (signal.aborted) return;
    handlers.onState(false);
    await sleep(Math.min(1000 * 2 ** Math.min(failures++, 4), 15000), signal);
  }
}
