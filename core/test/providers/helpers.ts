import { readFileSync } from 'node:fs';
import type { ProviderRequest } from '../../src/types.ts';

export function streamed(text: string): Response {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (offset === bytes.length) return controller.close();
    const size = [1, 7, 13, 3, 29][offset % 5]!;
    controller.enqueue(bytes.slice(offset, offset + size));
    offset = Math.min(bytes.length, offset + size);
  } }), { headers: { 'Content-Type': 'text/event-stream' } });
}

export const fixture = (name: string) => readFileSync(new URL(`fixtures/${name}.sse`, import.meta.url), 'utf8');
export async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const item of source) result.push(item);
  return result;
}
export const request: ProviderRequest = {
  model: 'test-model', system: 'Be helpful', maxTokens: 128,
  messages: [
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'checking' }, { type: 'tool_use', id: 'old', name: 'read_file', input: { path: 'a' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'old', content: 'missing', isError: true }] },
  ],
  tools: [{ name: 'read_file', description: 'Read a file', inputSchema: { type: 'object' } }],
};
