import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/providers/index.ts';
import type { ProviderConfig } from '../../src/types.ts';
import { streamed, request, collect } from './helpers.ts';

const noRetry = { retries: 0 };
const refused = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:9'), { code: 'ECONNREFUSED' }) });
const failure = async (cfg: ProviderConfig, fetchImpl: typeof fetch, apiKey?: string) => {
  const error = await collect(createProvider(cfg, apiKey, fetchImpl, noRetry).stream(request)).then(() => undefined, e => e as Error);
  assert.ok(error instanceof Error, 'the stream should fail');
  return error.message;
};
const openaiCfg: ProviderConfig = { id: 'o', kind: 'openai-compatible', baseUrl: 'https://llm.example.invalid:8443/v1/secret-path?x=1' };
const anthropicCfg: ProviderConfig = { id: 'a', kind: 'anthropic', baseUrl: 'https://llm.example.invalid:8443' };

test('connection refused names the endpoint', async () => {
  for (const cfg of [openaiCfg, anthropicCfg]) {
    const message = await failure(cfg, (async () => { throw refused(); }) as typeof fetch);
    assert.match(message, /https:\/\/llm\.example\.invalid:8443/);
    assert.match(message, /refused/i);
    assert.match(message, /ECONNREFUSED/);
    assert.doesNotMatch(message, /^fetch failed$/);
    assert.doesNotMatch(message, /secret-path|x=1/, 'only the origin is shown');
  }
  const closed = Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
  const stream = () => new Response(new ReadableStream({ start(c) { c.error(closed); } }));
  const message = await failure(openaiCfg, (async () => stream()) as typeof fetch);
  assert.match(message, /https:\/\/llm\.example\.invalid:8443/);
  assert.match(message, /closed the connection/);
  assert.notEqual(message, 'terminated');
});

test('Ollama down says Ollama is not running', async () => {
  for (const cfg of [{ id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1' }, { id: 'local', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' }] as ProviderConfig[]) {
    const origin = new URL(cfg.baseUrl).origin;
    assert.equal(await failure(cfg, (async () => { throw refused(); }) as typeof fetch),
      `Ollama is not running at ${origin} (start it with "ollama serve" or open the Ollama app)`);
  }
  assert.doesNotMatch(await failure({ id: 'x', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' }, (async () => { throw refused(); }) as typeof fetch), /Ollama/);
});

test('HTML error bodies are not shown', async () => {
  const html = '<html><head><title>502 Bad Gateway</title></head><body><center><h1>502 Bad Gateway</h1></center><hr><center>nginx</center></body></html>';
  for (const [body, type] of [[html, 'text/html'], [html, 'text/plain'], ['<!DOCTYPE html>\n' + html, '']] as const) {
    const message = await failure(openaiCfg, (async () => new Response(body, { status: 502, headers: type ? { 'Content-Type': type } : {} })) as typeof fetch);
    assert.match(message, /502/);
    assert.doesNotMatch(message, /<|nginx|Bad Gateway/);
  }
});

test('JSON error bodies show only their message', async () => {
  const openai = JSON.stringify({ error: { message: "This model's maximum context length is 3000 tokens.", type: 'invalid_request_error', code: 'context_length_exceeded' } });
  const anthropic = JSON.stringify({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } });
  assert.equal(await failure(openaiCfg, (async () => new Response(openai, { status: 400, headers: { 'Content-Type': 'application/json' } })) as typeof fetch),
    "Provider HTTP 400: This model's maximum context length is 3000 tokens.");
  assert.equal(await failure(anthropicCfg, (async () => new Response(anthropic, { status: 529 })) as typeof fetch), 'Provider HTTP 529: Overloaded');
  assert.equal(await failure(openaiCfg, (async () => new Response('{"message":"plain message"}', { status: 401 })) as typeof fetch), 'Provider HTTP 401: plain message');
  assert.equal(await failure(openaiCfg, (async () => new Response('{"detail":"Model not found"}', { status: 404 })) as typeof fetch), 'Provider HTTP 404: Model not found');
  const long = await failure(openaiCfg, (async () => new Response('oops '.repeat(2000), { status: 500 })) as typeof fetch);
  assert.ok(long.length < 400, 'a long text body is cut');
});

test('errors never contain the API key', async () => {
  const key = 'sk-' + 'q'.repeat(20);
  const escaped = JSON.stringify(key + '"\\').slice(1, -1);
  // [source, what the message must still say]: masking must not hide the cause.
  const sources: Array<[() => Response | Promise<Response>, RegExp]> = [
    [() => new Response(JSON.stringify({ error: { message: `Incorrect API key provided: ${key}` } }), { status: 401 }), /Incorrect API key provided: ••••qqqq/],
    [() => new Response(`bad key ${key}`, { status: 401 }), /bad key ••••qqqq/],
    [() => new Response(`{"error":{"message":"${escaped}"}}`, { status: 401 }), /Provider HTTP 401/],
    [() => { throw Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ECONNREFUSED Bearer ${key}`), { code: 'ECONNREFUSED' }) }); }, /refused/i],
    [() => { throw Object.assign(new TypeError('fetch failed'), { cause: new Error(`odd failure for ${key}`) }); }, /odd failure for ••••qqqq/],
    [() => streamed(`data: {"type":"error","error":{"message":"rejected ${key}"}}\n\n`), /rejected ••••qqqq/],
  ];
  for (const cfg of [openaiCfg, anthropicCfg, { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1' } as ProviderConfig]) {
    for (const [source, expected] of sources) {
      const message = await failure(cfg, (async () => source()) as typeof fetch, key);
      assert.ok(!message.includes(key) && !message.includes(escaped), message);
      assert.match(message, cfg.id === 'ollama' ? /Ollama is not running|odd failure|Provider|rejected|bad key/ : expected);
    }
  }
});

test('a key echoed across the body cut is fully masked', async () => {
  const key = 'sk-' + 'ab12'.repeat(16); // 67 characters, built at runtime
  const bodies = [JSON.stringify({ error: { message: 'x'.repeat(270) + key + ' end' } }), 'y'.repeat(270) + key + ' end', JSON.stringify({ message: 'z'.repeat(295) + key })];
  for (const body of bodies) {
    const message = await failure(openaiCfg, (async () => new Response(body, { status: 401 })) as typeof fetch, key);
    for (let i = 0; i + 8 <= key.length; i++) assert.ok(!message.includes(key.slice(i, i + 8)), `leaked ${key.slice(i, i + 8)} in ${message.slice(-60)}`);
    assert.ok(message.length < 400);
  }
});
