import type { Provider, ProviderConfig, StopReason, Usage } from '../types.ts';
import { readSse } from './sse.ts';
import { checkResponse, parseInput, safeError, validateTools } from './common.ts';

export function anthropic(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch): Provider {
  return { kind: 'anthropic', async *stream(req) {
    validateTools(req);
    const headers: Record<string, string> = { 'Content-Type': 'application/json', 'anthropic-version': '2023-06-01' };
    if (apiKey) headers['x-api-key'] = apiKey;
    try {
      const response = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/v1/messages`, {
        method: 'POST', headers, signal: req.signal, redirect: 'error',
        body: JSON.stringify({ model: req.model, system: req.system, max_tokens: req.maxTokens, stream: true,
          tools: req.tools.map(t => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
          messages: req.messages.map(m => ({ role: m.role, content: m.content.map(b => b.type === 'tool_result'
            ? { type: b.type, tool_use_id: b.toolUseId, content: b.content, is_error: b.isError ?? false } : b) })),
        }),
      });
      const blocks = new Map<number, { id: string; name: string; json: string; input: Record<string, unknown> }>();
      let usage: Usage = { inputTokens: 0, outputTokens: 0 }, stopReason: StopReason = 'end_turn';
      for await (const event of readSse(await checkResponse(response, apiKey))) {
        const value = JSON.parse(event.data);
        switch (value.type) {
          case 'message_start':
            usage.inputTokens = value.message?.usage?.input_tokens ?? 0;
            usage.outputTokens = value.message?.usage?.output_tokens ?? 0;
            break;
          case 'content_block_start': {
            const block = value.content_block;
            if (block.type === 'text' && block.text) yield { type: 'text_delta', text: block.text };
            if (block.type === 'tool_use') {
              blocks.set(value.index, { id: block.id, name: block.name, json: '', input: block.input ?? {} });
              yield { type: 'tool_call_start', id: block.id, name: block.name };
            }
            break;
          }
          case 'content_block_delta':
            if (value.delta.type === 'text_delta') yield { type: 'text_delta', text: value.delta.text };
            if (value.delta.type === 'input_json_delta') {
              const block = blocks.get(value.index);
              if (!block) throw new Error('Tool delta without a tool block');
              block.json += value.delta.partial_json;
            }
            break;
          case 'content_block_stop': {
            const block = blocks.get(value.index);
            if (block) {
              yield { type: 'tool_call', id: block.id, name: block.name, input: block.json ? parseInput(block.json) : block.input };
              blocks.delete(value.index);
            }
            break;
          }
          case 'message_delta':
            stopReason = value.delta.stop_reason === 'tool_use' ? 'tool_use' : value.delta.stop_reason === 'max_tokens' ? 'max_tokens' : 'end_turn';
            usage.outputTokens = value.usage?.output_tokens ?? usage.outputTokens;
            break;
          case 'message_stop':
            if (blocks.size) throw new Error('Provider stream has unfinished tool blocks');
            yield { type: 'done', stopReason, usage }; return;
          case 'error': throw safeError(`Provider error: ${value.error?.message ?? 'unknown error'}`, apiKey);
        }
      }
      throw new Error('Provider stream ended before message_stop');
    } catch (error) {
      if (req.signal?.aborted) throw error;
      throw safeError(error instanceof Error ? error.message : String(error), apiKey);
    }
  } };
}
