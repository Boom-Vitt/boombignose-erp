import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/providers/index.ts';
import { fixture, streamed, request, collect } from './helpers.ts';
import { readSse } from '../../src/providers/sse.ts';

test('anthropic reconstructs split tool inputs and converts tool results', async () => {
  let body: any; let headers: Headers;
  const provider = createProvider({ id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid/' }, 'fake', async (url, init) => {
    assert.equal(String(url), 'https://example.invalid/v1/messages');
    body = JSON.parse(String(init?.body)); headers = new Headers(init?.headers);
    return streamed(fixture('anthropic').replaceAll('\n', '\r\n'));
  });
  const events = await collect(provider.stream(request));
  assert.deepEqual(events.filter(e => e.type === 'tool_call'), [
    { type: 'tool_call', id: 'call_a', name: 'read_file', input: { path: 'a.txt' } },
    { type: 'tool_call', id: 'call_b', name: 'search_files', input: { pattern: 'hello' } },
  ]);
  assert.equal(events[0]?.type, 'text_delta');
  assert.deepEqual(events.at(-1), { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 42, outputTokens: 19 } });
  assert.equal(headers!.get('x-api-key'), 'fake');
  assert.equal(headers!.get('anthropic-version'), '2023-06-01');
  assert.equal(body.max_tokens, 128);
  assert.equal(body.system, 'Be helpful');
  assert.deepEqual(body.tools[0], { name: 'read_file', description: 'Read a file', input_schema: { type: 'object' } });
  assert.deepEqual(body.messages[2].content[0], { type: 'tool_result', tool_use_id: 'old', content: 'missing', is_error: true });
});

test('SSE joins multiline data and ignores comments across chunk boundaries', async () => {
  assert.deepEqual(await collect(readSse(streamed(': comment\r\nevent: test\r\ndata: first\r\ndata: second\r\n\r\n').body!)), [{ event: 'test', data: 'first\nsecond' }]);
});

test('anthropic HTTP and streamed errors redact supplied credentials', async () => {
  for (const response of [new Response('echo fake-value ' + 'z'.repeat(4000), { status: 401 }), streamed('event: error\ndata: {"type":"error","error":{"message":"fake-value"}}\n\n')]) {
    const p = createProvider({ id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid' }, 'fake-value', async () => response);
    await assert.rejects(collect(p.stream(request)), e => e instanceof Error && /Provider (HTTP 401|error)/.test(e.message) && !e.message.includes('fake-value') && e.message.length < 1500);
  }
});

test('anthropic refuses truncated streams and unfinished tool blocks', async () => {
  for (const text of [fixture('anthropic').split('event: message_stop')[0]!, 'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"a","name":"read_file","input":{}}}\n\ndata: {"type":"message_stop"}\n\n']) {
    const p = createProvider({ id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(text));
    await assert.rejects(collect(p.stream(request)), /stream|unfinished/i);
  }
});

test('anthropic cut-off or non-object tool arguments become a tool_call error', async () => {
  const start = 'data: {"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":"t1","name":"read_file","input":{}}}\n\n';
  const stop = 'data: {"type":"content_block_stop","index":0}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"max_tokens"}}\n\ndata: {"type":"message_stop"}\n\n';
  for (const json of ['{"path": ', '["a.txt"]']) {
    const text = start + `data: ${JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: json } })}\n\n` + stop;
    const provider = createProvider({ id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid' }, undefined, async () => streamed(text));
    const events = await collect(provider.stream(request));
    const call = events.find(e => e.type === 'tool_call');
    assert.deepEqual({ ...call, error: undefined }, { type: 'tool_call', id: 't1', name: 'read_file', input: {}, error: undefined });
    assert.match((call as { error: string }).error, /^Invalid tool arguments: /);
    assert.deepEqual(events.at(-1), { type: 'done', stopReason: 'max_tokens', usage: { inputTokens: 0, outputTokens: 0 } });
  }
});
