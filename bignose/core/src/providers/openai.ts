import type { Provider, ProviderConfig, StopReason, Usage } from '../types.ts';
import { readSse } from './sse.ts';
import { safeError, toolCall, validateTools } from './common.ts';
import { checkResponse, providerFailure } from './errors.ts';

export function openai(cfg: ProviderConfig, apiKey: string | undefined, fetchImpl: typeof fetch): Provider {
  return { kind: 'openai-compatible', async *stream(req) {
    validateTools(req);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const messages: Record<string, unknown>[] = [{ role: 'system', content: req.system }];
    for (const m of req.messages) {
      const calls = m.content.filter(b => b.type === 'tool_use');
      const text = m.content.filter(b => b.type === 'text').map(b => b.text).join('');
      if (text || calls.length) messages.push({ role: m.role, content: text || null,
        ...(calls.length ? { tool_calls: calls.map(b => ({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })) } : {}),
      });
      for (const b of m.content) if (b.type === 'tool_result') messages.push({ role: 'tool', tool_call_id: b.toolUseId, content: b.content });
    }
    try {
      const response = await fetchImpl(`${cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', headers, signal: req.signal, redirect: 'error',
        body: JSON.stringify({ model: req.model, messages, stream: true, stream_options: { include_usage: true },
          ...(cfg.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
          ...(req.tools.length ? { tools: req.tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })) } : {}),
        }),
      });
      // Keyed by `index`; servers that leave it out are keyed by call id, and a fragment with neither continues the latest call.
      const calls = new Map<number | string, { id: string; name: string; json: string; started: boolean }>();
      let latest: { id: string; name: string; json: string; started: boolean } | undefined;
      let usage: Usage = { inputTokens: 0, outputTokens: 0 }, stopReason: StopReason = 'end_turn';
      let finished = false;
      for await (const event of readSse(await checkResponse(response, apiKey))) {
        if (event.data === '[DONE]') {
          if (!finished) throw new Error('Provider stream missing finish reason');
          for (const [, call] of [...calls].sort((a, b) => typeof a[0] === 'number' && typeof b[0] === 'number' ? a[0] - b[0] : 0)) {
            if (!call.id || !call.name) throw new Error('Incomplete tool call');
            yield toolCall(call.id, call.name, call.json);
          }
          yield { type: 'done', stopReason, usage }; return;
        }
        const value = JSON.parse(event.data);
        if (value.error) throw safeError(`Provider error: ${value.error.message}`, apiKey);
        if (value.usage) usage = { inputTokens: value.usage.prompt_tokens ?? 0, outputTokens: value.usage.completion_tokens ?? 0 };
        const choice = value.choices?.[0];
        if (!choice) continue;
        if (choice.delta?.content) yield { type: 'text_delta', text: choice.delta.content };
        for (const delta of choice.delta?.tool_calls ?? []) {
          const key = delta.index ?? (delta.id ? `id:${delta.id}` : undefined);
          let call = key === undefined ? latest : calls.get(key);
          if (!call) { call = { id: '', name: '', json: '', started: false }; calls.set(key ?? calls.size, call); }
          call.id ||= delta.id ?? ''; call.name ||= delta.function?.name ?? ''; call.json += delta.function?.arguments ?? '';
          latest = call;
          if (call.id && call.name && !call.started) {
            call.started = true;
            yield { type: 'tool_call_start', id: call.id, name: call.name };
          }
        }
        if (choice.finish_reason) {
          finished = true;
          stopReason = choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'length' ? 'max_tokens' : 'end_turn';
        }
      }
      throw new Error('Provider stream ended before [DONE]');
    } catch (error) {
      if (req.signal?.aborted) throw error;
      throw providerFailure(error, cfg, apiKey);
    }
  } };
}
