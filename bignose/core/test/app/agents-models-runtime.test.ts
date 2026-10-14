import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { startDaemon } from '../../src/app/daemon.ts';
import { doctor } from '../../src/app/doctor.ts';
import { createProvider } from '../../src/providers/index.ts';
import { OLLAMA_CONTEXT_NOTE } from '../../src/providers/ollama.ts';
import { configured, testHome } from '../e2e/helpers.ts';

for (const kind of ['anthropic', 'openai-compatible'] as const) test(`${kind} max tokens: agent, provider, then v1 default in the outgoing body`, async t => {
  const home = testHome(t);
  configured(home, undefined, c => { c.providers[0]!.kind = kind; c.providers[0]!.maxTokens = 2048; });
  const bodies: any[] = [];
  const app = await startDaemon({ home, providerFactory: (cfg, key) => createProvider(cfg, key, async (_, init) => {
    bodies.push(JSON.parse(String(init!.body)));
    return new Response(kind === 'anthropic'
      ? 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":0}}\n\nevent: message_stop\ndata: {"type":"message_stop"}\n\n'
      : 'data: {"choices":[{"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  }) }); t.after(() => app.close());
  const agent = app.runtime.store.listAgents()[0]!;
  const run = async () => {
    const session = app.runtime.store.createSession({ agentId: agent.id, origin: { kind: 'desktop' } });
    const result = await app.runtime.start(session.id, 'hello').result;
    assert.equal(result.status, 'done', result.error);
    return bodies.at(-1);
  };
  app.runtime.store.updateAgent(agent.id, { maxTokens: 512 });
  assert.equal((await run()).max_tokens, 512); assert.equal(app.config().providers[0]!.maxTokens, 2048);
  app.runtime.store.updateAgent(agent.id, { maxTokens: null });
  assert.equal((await run()).max_tokens, 2048);
  const config = app.config(); delete config.providers[0]!.maxTokens;
  const res = await fetch(`http://127.0.0.1:${app.port}/api/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${app.token}` }, body: JSON.stringify({ config }) });
  assert.equal(res.status, 200);
  const body = await run();
  if (kind === 'anthropic') assert.equal(body.max_tokens, 8192); else assert.ok(!Object.hasOwn(body, 'max_tokens'));
});

for (const [label, data, expected] of [
  ['first run keeps qwen3:4b when it is installed', [{ id: 'a:1' }, { id: 'qwen3:4b' }], 'qwen3:4b'],
  ['first run keeps qwen3:4b when it is installed as :latest', [{ id: 'a:1' }, { id: 'qwen3:4b:latest' }], 'qwen3:4b'],
  ['first run picks another qwen3 tag when qwen3:4b is missing', [{ id: 'a:1' }, { id: 'qwen3:14b' }], 'qwen3:14b'],
  ['first run falls back to the first listed model', [{ id: 'a:1' }, { id: 'b:2' }], 'a:1'],
  ['first run keeps qwen3:4b from null', null, 'qwen3:4b'],
  ['first run keeps qwen3:4b from unreachable', 'unreachable', 'qwen3:4b'],
] as const) test(label, async t => {
  const home = testHome(t);
  let calls = 0;
  const app = await startDaemon({ home, fetchImpl: async (_, init) => {
    calls++; assert.ok(init!.signal); assert.equal(init!.redirect, 'error');
    if (data === 'unreachable') throw new Error('fake offline');
    return Response.json({ data });
  } }); t.after(() => app.close());
  assert.equal(calls, 1); assert.equal(app.config().active.model, expected);
  assert.equal(app.runtime.store.listAgents()[0]!.model, expected);
  if (expected !== 'qwen3:4b') assert.equal(JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')).active.model, expected);
});

test('existing config avoids first-run discovery and keeps the saved model', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.providers[0]!.id = 'ollama'; c.active = { provider: 'ollama', model: 'saved' }; });
  const app = await startDaemon({ home, fetchImpl: async () => { assert.fail('no first-run discovery'); } }); t.after(() => app.close());
  assert.equal(app.config().active.model, 'saved'); assert.equal(app.runtime.store.listAgents()[0]!.model, 'saved');
});

test('an offline first launch never repicks the model after the default agent exists', async t => {
  const home = testHome(t);
  const first = await startDaemon({ home, fetchImpl: async () => { throw new Error('fake offline'); } });
  t.after(() => first.close());
  assert.equal(first.runtime.store.listAgents()[0]!.model, 'qwen3:4b');
  await first.close();
  assert.equal(existsSync(join(home, 'config.json')), false);
  let calls = 0;
  const restarted = await startDaemon({ home, fetchImpl: async () => {
    calls++; return Response.json({ data: [{ id: 'llama3.2:latest' }] });
  } }); t.after(() => restarted.close());
  assert.equal(restarted.config().active.model, restarted.runtime.store.listAgents()[0]!.model);
  assert.equal(restarted.config().active.model, 'qwen3:4b');
  assert.equal(calls, 0);
});

test('first-run discovery has a two-second timeout', async t => {
  const home = testHome(t), started = Date.now();
  const app = await startDaemon({ home, fetchImpl: async (_, init) => {
    return await new Promise<Response>((_, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    });
  } }); t.after(() => app.close());
  assert.equal(app.config().active.model, 'qwen3:4b'); assert.ok(Date.now() - started < 3500);
});

test('doctor reports Ollama model count, context warning and note without requiring a key; warnings stay exit 0', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.providers[0]!.id = 'ollama'; c.providers[0]!.apiKeyEnv = 'OLLAMA_API_KEY'; c.providers[0]!.contextWindow = 32768; c.active.provider = 'ollama'; });
  const report = await doctor(home, async url => Response.json(String(url).endsWith('/models')
    ? { data: [{ id: 'a:1' }, { id: 'b:2' }] } : { models: [{ name: 'a:1', context_length: 4096 }] }));
  assert.equal(report.code, 0); assert.ok(report.lines.includes('ok Ollama has 2 models'));
  assert.ok(report.lines.some(s => /warn Ollama is running a:1.*4096-token/.test(s)));
  assert.ok(report.lines.includes(`note ${OLLAMA_CONTEXT_NOTE}`)); assert.ok(!report.lines.some(s => /key is unset/.test(s)));
  const offline = await doctor(home, async () => { throw new Error('fake offline'); });
  assert.equal(offline.code, 0); assert.equal(offline.lines.filter(s => s.startsWith('warn Ollama is not running')).length, 1);
  assert.equal(existsSync(join(home, 'bignose.db')), false);
});
