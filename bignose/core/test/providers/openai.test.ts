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

test('openai turns invalid JSON arguments into a tool_call error and rejects streams without DONE', async () => {
  const bad = fixture('openai').replace('lo\\\"}', 'lo');
  const p = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(bad));
  const events = await collect(p.stream(request));
  const failed = events.filter(e => e.type === 'tool_call' && e.error);
  assert.equal(failed.length, 1);
  assert.deepEqual((failed[0] as { input: unknown }).input, {});
  assert.match((failed[0] as { error: string }).error, /^Invalid tool arguments: .*complete JSON object/s);
  assert.equal(events.at(-1)?.type, 'done');
  const cut = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(fixture('openai').split('data: [DONE]')[0]!));
  await assert.rejects(collect(cut.stream(request)));
  const array = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(
    `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c', function: { name: 'read_file', arguments: '["a.txt"]' } }] }, finish_reason: 'tool_calls' }] })}\n\ndata: [DONE]\n\n`));
  const call = (await collect(array.stream(request))).find(e => e.type === 'tool_call');
  assert.deepEqual(call, { type: 'tool_call', id: 'c', name: 'read_file', input: {}, error: 'Invalid tool arguments: Tool arguments must be a JSON object. Send the call again with a complete JSON object.' });
});

test('openai non-2xx error is bounded and redacted', async () => {
  const p = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, 'fake-value', async () => new Response('fake-value'.repeat(500), { status: 429 }), { sleep: async () => {} });
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

test('tool_call deltas without index are kept apart by id', async () => {
  const chunk = (tool_calls: unknown[], finish?: string) => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls }, ...(finish ? { finish_reason: finish } : {}) }] })}\n\n`;
  const text = chunk([{ id: 'call_a', type: 'function', function: { name: 'read_file', arguments: '{"path":' } }])
    + chunk([{ id: 'call_a', function: { arguments: '"a.txt"}' } }])
    + chunk([{ id: 'call_b', type: 'function', function: { name: 'search_files', arguments: '{"pattern":"hello"}' } }], 'tool_calls')
    + 'data: [DONE]\n\n';
  const provider = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(text));
  const events = await collect(provider.stream(request));
  assert.deepEqual(events.filter(e => e.type === 'tool_call'), [
    { type: 'tool_call', id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool_call', id: 'call_b', name: 'search_files', input: { pattern: 'hello' } },
  ]);
  // A fragment with neither index nor id continues the call that is being streamed.
  const tail = chunk([{ id: 'call_c', function: { name: 'read_file', arguments: '{"path":' } }]) + chunk([{ function: { arguments: '"c.txt"}' } }], 'tool_calls') + 'data: [DONE]\n\n';
  const next = createProvider({ id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(tail));
  assert.deepEqual((await collect(next.stream(request))).filter(e => e.type === 'tool_call'), [{ type: 'tool_call', id: 'call_c', name: 'read_file', input: { path: 'c.txt' } }]);
});
