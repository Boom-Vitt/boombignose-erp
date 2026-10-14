import type { ProviderConfig } from '../types.ts';
import { safeError } from './common.ts';
import { isOllama, ollamaDownMessage } from './ollama.ts';

/** A provider failure with the facts the retry layer needs. `message` is already redacted and bounded. */
export class ProviderError extends Error {
  status?: number;
  retryable = false;
  retryAfterMs?: number;
}

const RETRY_STATUS = new Set([429, 500, 502, 503, 529]);
// code -> [could not connect | connection dropped, short reason, worth another try]
const NETWORK: Record<string, ['connect' | 'closed', string, boolean]> = {
  ECONNREFUSED: ['connect', 'connection refused', true],
  ENOTFOUND: ['connect', 'host not found', false],
  EAI_AGAIN: ['connect', 'host lookup failed', true],
  EHOSTUNREACH: ['connect', 'host unreachable', false],
  ENETUNREACH: ['connect', 'network unreachable', false],
  ETIMEDOUT: ['connect', 'connection timed out', true],
  UND_ERR_CONNECT_TIMEOUT: ['connect', 'connection timed out', true],
  ECONNRESET: ['closed', 'connection reset', true],
  EPIPE: ['closed', 'broken pipe', true],
  UND_ERR_SOCKET: ['closed', 'socket closed', true],
};

function make(text: string, apiKey: string | undefined, extra: Partial<ProviderError> = {}): ProviderError {
  return Object.assign(new ProviderError(safeError(text, apiKey).message), extra);
}

function retryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const ms = /^\d+(\.\d+)?$/.test(header.trim()) ? Number(header) * 1000 : Date.parse(header) - Date.now();
  return Number.isFinite(ms) ? Math.max(0, ms) : undefined;
}

/** The human message of a JSON error body (OpenAI, Anthropic, FastAPI shapes); plain text is passed through, and an unreadable body gives nothing. */
function bodyMessage(text: string): string | undefined {
  const body = text.trim();
  try {
    const v = JSON.parse(body);
    const message = v?.error?.message ?? v?.message ?? v?.detail ?? v?.error;
    return typeof message === 'string' ? message : undefined;
  } catch { return body || undefined; }
}

export async function checkResponse(response: Response, apiKey?: string): Promise<ReadableStream<Uint8Array>> {
  if (!response.ok) {
    const text = await response.text();
    // A proxy's error page (nginx, Cloudflare) is noise for the user: say what it is and nothing more.
    const html = /html/i.test(response.headers.get('content-type') ?? '') || /^\s*<(!doctype|html|head|body)\b/i.test(text);
    const message = html ? undefined : bodyMessage(text);
    // Redact first, then cut: a key echoed across the cut must not leave a readable prefix.
    const shown = message && safeError(message, apiKey).message.slice(0, 300);
    throw make(`Provider HTTP ${response.status}${html ? ': the server answered with a web page, not an API response' : shown ? `: ${shown}` : ''}`, apiKey,
      { status: response.status, retryable: RETRY_STATUS.has(response.status), retryAfterMs: retryAfter(response.headers.get('retry-after')) });
  }
  if (!response.body) throw new Error('Provider returned an empty stream');
  return response.body;
}

function codeOf(error: unknown): string | undefined {
  for (let e = error as { code?: unknown; cause?: unknown } | undefined, depth = 0; e && typeof e === 'object' && depth < 4; e = e.cause as typeof e, depth++)
    if (typeof e.code === 'string' && e.code in NETWORK) return e.code;
  return undefined;
}

/** Turn whatever fetch or the stream threw into an error that names the endpoint and the cause. */
export function providerFailure(error: unknown, cfg: ProviderConfig, apiKey: string | undefined): Error {
  if (error instanceof ProviderError) return error;
  const message = error instanceof Error ? error.message : String(error);
  const code = codeOf(error);
  let origin = 'the provider';
  try { origin = new URL(cfg.baseUrl).origin; } catch { /* keep the generic name */ }
  if (code === 'ECONNREFUSED' && isOllama(cfg)) return make(ollamaDownMessage(origin), apiKey, { retryable: true });
  if (code) {
    const [kind, reason, retryable] = NETWORK[code]!;
    return make(kind === 'connect' ? `Cannot reach the provider at ${origin} (${reason}, ${code})`
      : `The provider at ${origin} closed the connection before finishing (${reason}, ${code})`, apiKey, { retryable });
  }
  // undici hides the reason behind a bare "fetch failed" / "terminated"; its cause says more.
  if (/^(fetch failed|terminated)$/.test(message)) {
    const cause = (error as { cause?: unknown }).cause;
    const detail = cause instanceof Error && cause.message ? `${cause.message} (${message})` : message;
    return make(`Network error talking to ${origin}: ${detail}`, apiKey);
  }
  return make(message, apiKey);
}
