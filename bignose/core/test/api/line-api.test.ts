import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { setSecret } from '../../src/config.ts';
import { startDaemon } from '../../src/app/daemon.ts';
import type { Config, Provider } from '../../src/types.ts';
import type { TestContext } from 'node:test';
import { configured, testHome } from '../e2e/helpers.ts';

async function setup(t: TestContext, change?: (c: Config) => void) {
  const home = testHome(t); process.env.BIGNOSE_HOME = home;
  configured(home, undefined, change);
  const calls: { path: string; method?: string; body?: unknown }[] = [];
  let httpStatus = 200, success = true;
  let runs = 0;
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    runs++; yield { type: 'text_delta', text: 'answer' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider, lineOptions: { apiBase: 'https://line.example', fetchImpl: async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
    if (httpStatus !== 200) return new Response('test-token test-secret invalid', { status: httpStatus });
    return Response.json(path.endsWith('/info') ? { displayName: 'BigNose', basicId: '@bn', userId: 'Ubot' }
      : path.endsWith('/test') ? { success, statusCode: success ? 200 : 503, reason: success ? 'OK' : 'ERROR', detail: success ? 'Verified' : 'Unavailable' } : {});
  } } });
  t.after(() => a.close());
  const call = async (path: string, method = 'POST', body?: unknown) => {
    const r = await fetch(`http://127.0.0.1:${a.port}/api/${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, body: await r.json() as any };
  };
  return { a, home, calls, call, runs: () => runs, status: (v: number) => { httpStatus = v; }, success: (v: boolean) => { success = v; } };
}

test('connect reports each setup step and only sets a validated HTTPS webhook', async t => {
  const s = await setup(t);
  assert.deepEqual(await s.call('line/connect'), { status: 200, body: { ok: false, steps: [
    { name: 'token', ok: false, detail: 'Save the channel access token first.' },
    { name: 'webhook', ok: false, detail: 'Fix the token first.' },
  ] } });
  assert.deepEqual(s.calls, []);
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', s.home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', s.home);
  s.status(401);
  let result = await s.call('line/connect');
  assert.equal(result.status, 200); assert.equal(result.body.ok, false);
  assert.match(result.body.steps[0].detail, /failed: 401 \*\*\* \*\*\*/);
  assert.equal(result.body.steps[1].detail, 'Fix the token first.');
  s.status(200);
  result = await s.call('line/connect');
  assert.deepEqual(result.body.bot, { displayName: 'BigNose', basicId: '@bn' });
  assert.equal(result.body.steps[0].detail, 'Connected to BigNose (@bn)');
  assert.equal(result.body.steps[1].detail, 'Set a public HTTPS URL first.');
  const config = s.a.config(); config.line.publicUrl = 'https://tunnel.example/base///';
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  result = await s.call('line/connect');
  assert.equal(result.body.ok, true);
  assert.equal(result.body.webhookUrl, 'https://tunnel.example/base/line/webhook');
  assert.deepEqual(result.body.steps[1], { name: 'webhook', ok: true, detail: 'Webhook set to https://tunnel.example/base/line/webhook' });
  assert.deepEqual(s.calls.at(-1), { path: '/v2/bot/channel/webhook/endpoint', method: 'PUT', body: { endpoint: 'https://tunnel.example/base/line/webhook' } });
});

test('the daemon dedupes a redelivered event after settings rebuild the LINE listener', async t => {
  const s = await setup(t, c => { c.line.allow.users = ['Uowner']; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', s.home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', s.home);
  const config = s.a.config(); config.line.enabled = true;
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  const raw = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'same-event', replyToken: 'reply',
    source: { type: 'user', userId: 'Uowner' }, message: { type: 'text', text: 'hi' } }] });
  const post = () => fetch(`http://127.0.0.1:${s.a.lineStatus().port}/line/webhook`, { method: 'POST', body: raw,
    headers: { 'X-Line-Signature': createHmac('sha256', 'test-secret').update(raw).digest('base64') } });
  assert.equal((await post()).status, 200);
  for (let i = 0; !s.calls.some(c => c.path === '/v2/bot/message/reply') && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(s.runs(), 1);
  config.line.slowResponseMs = 3000;
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  assert.equal((await post()).status, 200);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(s.runs(), 1);
  assert.equal(s.a.runtime.store.getMessages(s.a.runtime.store.listSessions()[0]!.id).length, 2);
});

test('stored HTTP URLs load and allow unrelated saves while new HTTP URLs fail', async t => {
  const s = await setup(t, c => { c.line.publicUrl = 'http://old.example'; });
  const status = (await s.call('line/status', 'GET')).body;
  assert.equal(status.healthUrl, 'http://old.example/line/webhook/health');
  assert.equal(status.warnings.length, 2);
  assert.equal(status.warnings[0], 'Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.');
  assert.match(status.warnings[1], /HTTPS/);
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', s.home);
  const connected = (await s.call('line/connect')).body;
  assert.equal(connected.ok, false); assert.match(connected.steps[1].detail, /HTTPS/);
  assert.equal(s.calls.filter(c => c.method === 'PUT').length, 0);
  const config = s.a.config(); config.providers[0]!.label = 'Changed';
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  config.line.publicUrl = 'http://new.example';
  const rejected = await s.call('settings', 'PUT', { config });
  assert.equal(rejected.status, 400); assert.match(rejected.body.error, /HTTPS/);
  assert.equal(s.a.config().line.publicUrl, 'http://old.example');
});

test('test webhook checks prerequisites and returns LINE success or failure details', async t => {
  const s = await setup(t, c => { c.line.publicUrl = 'https://tunnel.example'; c.line.allow.users = ['Uowner']; });
  assert.equal((await s.call('line/test')).body.detail, 'Save the channel access token first.');
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', s.home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', s.home);
  assert.deepEqual((await s.call('line/test')).body, { ok: false, running: false,
    detail: 'The LINE listener is not running. Turn LINE on, save, then test again.' });
  assert.equal(s.calls.length, 0);
  const config = s.a.config(); config.line.enabled = true;
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  assert.deepEqual((await s.call('line/test')).body, { ok: true, running: true, statusCode: 200, reason: 'OK', detail: 'Verified' });
  assert.deepEqual(s.calls.at(-1), { path: '/v2/bot/channel/webhook/test', method: 'POST', body: { endpoint: 'https://tunnel.example/line/webhook' } });
  s.success(false);
  assert.deepEqual((await s.call('line/test')).body, { ok: false, running: true, statusCode: 503, reason: 'ERROR', detail: 'Unavailable' });
  const status = (await s.call('line/status', 'GET')).body;
  assert.equal(status.healthUrl, 'https://tunnel.example/line/webhook/health'); assert.deepEqual(status.warnings, []);
});

test('public URL spaces are trimmed on save and on connect/test for legacy config', async t => {
  const s = await setup(t, c => { c.line.publicUrl = ' '.repeat(250) + 'https://tunnel.example/base/' + ' '.repeat(250); });
  assert.deepEqual([s.a.lineStatus().webhookUrl, s.a.lineStatus().healthUrl, s.a.lineStatus().warnings], ['https://tunnel.example/base/line/webhook', 'https://tunnel.example/base/line/webhook/health', ['Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.']]);
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', s.home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', s.home);
  assert.equal((await s.call('line/connect')).body.webhookUrl, 'https://tunnel.example/base/line/webhook');
  const config = s.a.config(); config.line.publicUrl = '  https://new.example/base///  '; config.line.enabled = true;
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  assert.equal(s.a.config().line.publicUrl, 'https://new.example/base///');
  assert.equal((await s.call('line/test')).body.ok, true);
  assert.deepEqual(s.calls.at(-1)?.body, { endpoint: 'https://new.example/base/line/webhook' });
});

test('trimming an unchanged legacy HTTP URL still permits unrelated whole-config saves', async t => {
  const s = await setup(t, c => { c.line.publicUrl = '  http://old.example  '; });
  assert.equal(s.a.lineStatus().warnings[1], 'Public URL must use HTTPS.');
  const config = s.a.config(); config.providers[0]!.label = 'Changed';
  assert.equal((await s.call('settings', 'PUT', { config })).status, 200);
  assert.equal(s.a.config().line.publicUrl, 'http://old.example');
});
