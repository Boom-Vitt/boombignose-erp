import type { Provider, ProviderConfig } from '../types.ts';
import { anthropic } from './anthropic.ts';
import { openai } from './openai.ts';
export function createProvider(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch = fetch): Provider {
  return cfg.kind === 'anthropic' ? anthropic(cfg, apiKey, fetchImpl) : openai(cfg, apiKey, fetchImpl);
}
