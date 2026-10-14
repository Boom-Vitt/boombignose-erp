import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProvider } from '../../src/providers/index.ts';
import { fixture, streamed, request, collect } from './helpers.ts';

test('the recorded Ollama stream ignores reasoning and returns both calls with trailing usage', async () => {
  const text = readFileSync(new URL('fixtures/ollama-tools.sse', import.meta.url), 'utf8');
  const provider = createProvider({ id: 'ollama', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1' }, undefined, async () => streamed(text));
  assert.deepEqual(await collect(provider.stream({ ...request, model: 'qwen3:14b' })), [
    { type: 'tool_call_start', id: 'call_1h9aicm7', name: 'get_weather' },
    { type: 'tool_call_start', id: 'call_067750nw', name: 'get_weather' },
    { type: 'tool_call', id: 'call_1h9aicm7', name: 'get_weather', input: { city: 'Tokyo' } },
    { type: 'tool_call', id: 'call_067750nw', name: 'get_weather', input: { city: 'Paris' } },
    { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 141, outputTokens: 154 } },
  ]);
});

test('keyless Ollama sends a finished tool round with null assistant content and tool_call_id', async () => {
  for (const key of [undefined, '']) {
    const provider = createProvider({ id: 'ollama', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1' }, key, async (url, init) => {
      assert.equal(String(url), 'https://example.invalid/v1/chat/completions');
      assert.equal(new Headers(init?.headers).has('Authorization'), false);
      assert.equal(init?.redirect, 'error');
      const body = JSON.parse(String(init?.body));
      assert.deepEqual(body.stream_options, { include_usage: true });
      assert.equal('max_tokens' in body, false);
      assert.deepEqual(body.messages, [
        { role: 'system', content: 'Be helpful' },
        { role: 'assistant', content: null, tool_calls: [
          { id: 'weather', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Tokyo"}' } },
        ] },
        { role: 'tool', tool_call_id: 'weather', content: 'Sunny' },
      ]);
      return streamed('data: {"choices":[{"delta":{"content":"Sunny"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
    });
    assert.deepEqual(await collect(provider.stream({ ...request, messages: [
      { role: 'assistant', content: [{ type: 'tool_use', id: 'weather', name: 'get_weather', input: { city: 'Tokyo' } }] },
      { role: 'user', content: [{ type: 'tool_result', toolUseId: 'weather', content: 'Sunny' }] },
    ] })), [
      { type: 'text_delta', text: 'Sunny' },
      { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } },
    ]);
  }
});

test('openai reconstructs parallel calls in index order and trailing usage', async () => {
  let body: any;
  const provider = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1' }, undefined, async (url, init) => {
    assert.equal(String(url), 'https://example.invalid/v1/chat/completions');
    assert.equal(new Headers(init?.headers).has('Authorization'), false);
    body = JSON.parse(String(init?.body));
    return streamed(fixture('openai'));
  });
  const events = await collect(provider.stream(request));
  assert.deepEqual(events.filter(e => e.type === 'tool_call'), [
    { type: 'tool_call', id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool_call', id: 'call_b', name: 'search_files', input: { pattern: 'hello' } },
  ]);
  assert.equal(events.filter(e => e.type === 'text_delta').map(e => e.text).join(''), 'Checking ไทย');
  assert.deepEqual(events.at(-1), { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 42, outputTokens: 19 } });
  assert.deepEqual(body.messages[0], { role: 'system', content: 'Be helpful' });
  assert.deepEqual(body.messages[2].tool_calls, [{ id: 'old', type: 'function', function: { name: 'read_file', arguments: '{"path":"a"}' } }]);
  assert.deepEqual(body.messages[3], { role: 'tool', tool_call_id: 'old', content: 'missing' });
  assert.deepEqual(body.stream_options, { include_usage: true });
  assert.equal('max_tokens' in body, false);
});

test('openai uses configured max tokens and auth, rejects illegal tool names before fetch', async () => {
  let fetched = 0;
  const p = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid', maxTokens: 80 }, 'fake', async (_, init) => {
    fetched++;
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer fake');
    assert.equal(JSON.parse(String(init?.body)).max_tokens, 128);
    return streamed('data: {"choices":[{"delta":{},"finish_reason":"length"}]}\n\ndata: [DONE]\n\n');
  });
  assert.deepEqual((await collect(p.stream(request))).at(-1), { type: 'done', stopReason: 'max_tokens', usage: { inputTokens: 0, outputTokens: 0 } });
  await assert.rejects(collect(p.stream({ ...request, tools: [{ ...request.tools[0]!, name: 'bad.name' }] })), /tool name/i);
  assert.equal(fetched, 1);
});

test('openai rejects invalid JSON arguments and streams without DONE', async () => {
  for (const text of [fixture('openai').replace('lo\\\"}', 'lo'), fixture('openai').split('data: [DONE]')[0]!]) {
    const p = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(text));
    await assert.rejects(collect(p.stream(request)));
  }
});

test('openai non-2xx error is bounded and redacted', async () => {
  const p = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, 'fake-value', async () => new Response('fake-value'.repeat(500), { status: 429 }));
  await assert.rejects(collect(p.stream(request)), e => e instanceof Error && e.message.includes('429') && !e.message.includes('fake-value') && e.message.length < 1500);
});

test('openai keeps first id and name when compatible servers repeat them in later chunks', async () => {
  const text = fixture('openai')
    .replace('{"index":1,"function":{"arguments":', '{"index":1,"id":"call_b","function":{"name":"search_files","arguments":')
    .replace('{"index":0,"function":{"arguments":', '{"index":0,"id":"call_a","function":{"name":"read_file","arguments":');
  const provider = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(text));
  const events = await collect(provider.stream(request));
  assert.deepEqual(events.filter(e => e.type === 'tool_call'), [
    { type: 'tool_call', id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool_call', id: 'call_b', name: 'search_files', input: { pattern: 'hello' } },
  ]);
  assert.equal(events.filter(e => e.type === 'tool_call_start').length, 2);
});
