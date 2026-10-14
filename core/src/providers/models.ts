import type { ProviderConfig } from '../types.ts';
import { safeError } from './common.ts';
import { isOllama } from './ollama.ts';

export interface ModelInfo { id: string; label?: string }

export async function listModels(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Promise<ModelInfo[]> {
  const fail = (text: string): Error => {
    const error = safeError(text, apiKey);
    error.message = error.message.trimEnd().replace(/\.+$/, '');
    return error;
  };
  const baseUrl = cfg.baseUrl.replace(/\/+$/, '');
  const headers: Record<string, string> = {};
  if (cfg.kind === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01';
    if (apiKey) headers['x-api-key'] = apiKey;
  } else if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}${cfg.kind === 'anthropic' ? '/v1/models?limit=1000' : '/models'}`, {
      method: 'GET', headers, signal: AbortSignal.timeout(15000), redirect: 'error',
    });
  } catch (error) {
    throw fail(isOllama(cfg)
      ? `Ollama is not running at ${new URL(baseUrl).origin} (start it with "ollama serve" or open the Ollama app)`
      : `Could not list models: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw fail(`Could not list models: ${response.status} ${safeError(body, apiKey).message.slice(0, 200)}`);
  }
  let data: unknown;
  try { data = (await response.json())?.data; }
  catch { throw fail('Could not list models: unexpected response'); }
  if (data !== null && !Array.isArray(data)) throw fail('Could not list models: unexpected response');
  const models: ModelInfo[] = (data ?? []).filter(model => typeof model?.id === 'string').map(model => ({
    id: model.id,
    ...(cfg.kind === 'anthropic' && typeof model.display_name === 'string' ? { label: model.display_name } : {}),
  }));
  if (!models.length) throw fail(isOllama(cfg)
    ? 'Ollama has no models yet (install one with "ollama pull qwen3")'
    : 'The provider returned no models');
  return models;
}
