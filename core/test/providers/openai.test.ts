import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/providers/index.ts';
import { fixture, streamed, request, collect } from './helpers.ts';

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
