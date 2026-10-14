import type { ProviderConfig } from '../types.ts';
import { safeError } from './common.ts';

export const OLLAMA_DEFAULT_MODEL = 'qwen3:4b';
export const OLLAMA_CONTEXT_NOTE = 'Ollama picks its own context size (OLLAMA_CONTEXT_LENGTH, only 4096 tokens on machines with less than 24 GB of GPU memory) and cuts longer prompts without an error. For agents, start Ollama with OLLAMA_CONTEXT_LENGTH=32768 ollama serve (for the Ollama app: launchctl setenv OLLAMA_CONTEXT_LENGTH 32768, then restart the app) and keep Context window here at or below that number. ollama ps shows the size in use.';

export function isOllama(cfg: ProviderConfig): boolean {
  if (cfg.kind !== 'openai-compatible') return false;
  if (cfg.id === 'ollama') return true;
  try { return new URL(cfg.baseUrl).port === '11434'; }
  catch { return false; }
}

export const ollamaDownMessage = (origin: string) => `Ollama is not running at ${origin} (start it with "ollama serve" or open the Ollama app)`;

export async function ollamaWarnings(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string[]> {
  try {
    const origin = new URL(cfg.baseUrl).origin;
    const headers: Record<string, string> = {};
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    let response: Response;
    try {
      response = await fetchImpl(`${origin}/api/ps`, { method: 'GET', headers, signal: AbortSignal.timeout(2000), redirect: 'error' });
    } catch {
      return [safeError(ollamaDownMessage(origin), apiKey).message];
    }
    if (!response.ok) return [];
    const value = await response.json();
    if (!Array.isArray(value?.models)) return [];
    const cw = cfg.contextWindow ?? 128000;
    return value.models.filter((model: any) => typeof model?.name === 'string' && typeof model.context_length === 'number' && model.context_length < cw)
      .map((model: any) => safeError(`Ollama is running ${model.name} with a ${model.context_length}-token context, below this provider's Context window (${cw}). Restart Ollama with OLLAMA_CONTEXT_LENGTH=${cw}, or set Context window to ${model.context_length}.`, apiKey).message);
  } catch { return []; }
}
