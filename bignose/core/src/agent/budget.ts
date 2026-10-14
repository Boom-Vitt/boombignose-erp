import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message } from '../types.ts';

/** Provider-legal tool name. Anything else would make every later request fail, so it is never stored. */
export const safeName = (name: string) => /^[a-zA-Z0-9_-]{1,64}$/.test(name) ? name : name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || 'invalid_tool';

/** A tool result may use about 15% of the context window (4 characters a token), at least 2,000 and at most the 100,000 of the tools' own cap. */
export const resultCap = (contextWindow: number) => Math.min(100_000, Math.max(2_000, Math.floor(contextWindow * 0.6)));

const PREVIEW = 1500;
export async function budgetResult(content: string, cap: number, spillDir: string | undefined, redact: (text: string) => string = s => s): Promise<string> {
  if (content.length <= cap) return content;
  const clean = redact(content); // redact the whole text before any cut, so a secret crossing the cut leaves no readable prefix
  const preview = clean.slice(0, PREVIEW);
  const head = `${preview}\n\n[Tool output was ${content.length} characters, more than the ${cap} this model's context window allows for one result. Only the first ${PREVIEW} are shown.`;
  if (spillDir) {
    try {
      await mkdir(spillDir, { recursive: true, mode: 0o700 });
      // shortcut: spill files are never deleted, add an age-based sweep when the folder grows.
      const file = join(spillDir, `${randomUUID()}.txt`);
      await writeFile(file, clean, { mode: 0o600 });
      return `${head} The full output is saved at ${file}: read it in parts with read_file (offset, limit).]`;
    } catch { /* fall through: the preview alone is still better than failing the run */ }
  }
  return `${head} The rest was truncated.]`;
}

const CLEARED = '\n[Tool output cleared to save context space]';
/** New messages (the input is not mutated) with the oldest large tool results cut to a short head until about `excessChars` are freed. */
export function pruneResults(context: Message[], excessChars: number, redact: (text: string) => string = s => s): Message[] {
  let freed = 0;
  const shrink = (text: string) => { const next = redact(text).slice(0, 500) + CLEARED; freed += text.length - next.length; return next; };
  return context.map(m => freed >= excessChars ? m : { ...m, content: m.content.map(b =>
    freed < excessChars && b.type === 'tool_result' && b.content.length > 1000 ? { ...b, content: shrink(b.content) } : b) });
}

/** The provider says the request was larger than the model's context (OpenAI/Anthropic/Ollama-compatible wording, or HTTP 413). */
export const isContextOverflow = (error: unknown) =>
  error instanceof Error && /context[ _]length|context window|prompt is too long|too many tokens|maximum context|exceeds the (model|context)|HTTP 413\b|payload too large|request too large/i.test(error.message);
