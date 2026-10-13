import { redact } from '../config.ts';
import type { ProviderRequest } from '../types.ts';

export function safeError(text: string, apiKey?: string): Error {
  const values = apiKey ? [apiKey, JSON.stringify(apiKey).slice(1, -1)] : [];
  return new Error(redact(text, values).slice(0, 1000));
}

export function validateTools(req: ProviderRequest): void {
  const names = [...req.tools.map(t => t.name), ...req.messages.flatMap(m => m.content.flatMap(b => b.type === 'tool_use' ? [b.name] : []))];
  for (const name of names) if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error('Invalid tool name');
}

export function parseInput(text: string): Record<string, unknown> {
  const value: unknown = JSON.parse(text || '{}');
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Tool arguments must be a JSON object');
  return value as Record<string, unknown>;
}

export async function checkResponse(response: Response, apiKey?: string): Promise<ReadableStream<Uint8Array>> {
  if (!response.ok) throw safeError(`Provider HTTP ${response.status}: ${await response.text()}`, apiKey);
  if (!response.body) throw new Error('Provider returned an empty stream');
  return response.body;
}
