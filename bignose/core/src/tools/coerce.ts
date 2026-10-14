import type { JsonSchema } from '../types.ts';

/** Models often send numbers and booleans as strings ("10", "true"); fix those from the tool's own schema. Anything else is left for the tool to reject. */
export function coerceArgs(input: Record<string, unknown>, schema: JsonSchema): Record<string, unknown> {
  const out = { ...input };
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const value = out[key], types = ([] as unknown[]).concat(prop?.type);
    if (typeof value !== 'string' || types.includes('string')) continue;
    const text = value.trim();
    if ((types.includes('integer') || types.includes('number')) && /^-?\d+(\.\d+)?$/.test(text)) out[key] = Number(text);
    else if (types.includes('boolean') && /^(true|false)$/i.test(text)) out[key] = text.toLowerCase() === 'true';
  }
  return out;
}
