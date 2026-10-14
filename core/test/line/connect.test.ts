import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { RequestListener } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as line from '../../src/line/index.ts';
import { testHome } from '../e2e/helpers.ts';

async function server(t: { after(fn: () => unknown): void }, handler: RequestListener) {
  const s = createServer(handler);
  await new Promise<void>(resolve => s.listen(0, '127.0.0.1', resolve));
  t.after(() => { s.closeAllConnections(); s.close(); });
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

test('LINE setup helpers send authenticated requests, time out at 15 seconds and parse results', async t => {
  process.env.BIGNOSE_HOME = testHome(t);
  assert.equal(typeof line.lineBotInfo, 'function');
  const calls: { path: string; init: RequestInit }[] = [];
  const fetchImpl: typeof fetch = async (url, init = {}) => {
    calls.push({ path: String(url), init });
    return Response.json(String(url).endsWith('/info')
      ? { displayName: 'BigNose', basicId: '@bn', pictureUrl: 'https://img.example/bot', userId: 'Ubot' }
      : String(url).endsWith('/test') ? { success: true, statusCode: 200, reason: 'OK', detail: 'Verified', timestamp: 'today' } : {});
  };
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  const delays: number[] = [];
  t.mock.method(AbortSignal, 'timeout', (ms: number) => { delays.push(ms); return timeout(ms); });
  const o = { accessToken: 'test-token', fetchImpl, apiBase: 'https://line.example/' };
  assert.deepEqual(await line.lineBotInfo(o), { displayName: 'BigNose', basicId: '@bn', pictureUrl: 'https://img.example/bot' });
  assert.equal(await line.setLineWebhook(o, 'https://tunnel.example/line/webhook'), undefined);
  assert.deepEqual(await line.testLineWebhook(o, 'https://tunnel.example/line/webhook'),
    { success: true, statusCode: 200, reason: 'OK', detail: 'Verified', timestamp: 'today' });
  assert.deepEqual(calls.map(c => [c.path, c.init.method, c.init.body]), [
    ['https://line.example/v2/bot/info', 'GET', undefined],
    ['https://line.example/v2/bot/channel/webhook/endpoint', 'PUT', '{"endpoint":"https://tunnel.example/line/webhook"}'],
    ['https://line.example/v2/bot/channel/webhook/test', 'POST', '{"endpoint":"https://tunnel.example/line/webhook"}'],
  ]);
  assert.deepEqual(delays, [15000, 15000, 15000]);
  for (const { init } of calls) {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer test-token');
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.redirect, 'error');
  }
});

test('LINE helper errors mask both credentials before truncating the response', async t => {
  process.env.BIGNOSE_HOME = testHome(t);
  assert.equal(typeof line.lineBotInfo, 'function');
  const o = { accessToken: 'test-token', channelSecret: 'test-secret', fetchImpl: (async () =>
    new Response('test-token test-secret ' + 'x'.repeat(300), { status: 401 })) as typeof fetch };
  for (const call of [() => line.lineBotInfo(o), () => line.setLineWebhook(o, 'https://tunnel.example/line/webhook'),
    () => line.testLineWebhook(o, 'https://tunnel.example/line/webhook')]) {
    await assert.rejects(call, (e: Error) => {
      assert.match(e.message, /^LINE \/v2\/bot\/.* failed: 401 \*\*\* \*\*\*/);
      assert.equal(e.message.includes('test-token'), false);
      assert.equal(e.message.includes('test-secret'), false);
      assert.equal(e.message.split('failed: 401 ')[1]!.length, 200);
      return true;
    });
  }
  await assert.rejects(line.lineBotInfo({ ...o, fetchImpl: async () => { throw new Error('test-token test-secret'); } }), /\*\*\* \*\*\*/);
});

test('token-bearing LINE requests refuse a redirect to another origin', async t => {
  process.env.BIGNOSE_HOME = testHome(t);
  assert.equal(typeof line.lineBotInfo, 'function');
  let reached = false;
  const other = await server(t, (_req, res) => { reached = true; res.end('{}'); });
  const apiBase = await server(t, (_req, res) => { res.writeHead(307, { Location: other + '/stolen' }); res.end(); });
  await assert.rejects(line.lineBotInfo({ accessToken: 'test-token', apiBase }));
  assert.equal(reached, false);
});

test('public URLs reject HTTP, credentials, queries, fragments and overlong values', () => {
  assert.equal(typeof line.publicUrlProblem, 'function');
  for (const url of ['http://example.com', 'https://u:p@example.com', 'https://example.com?q=1',
    'https://example.com#x', 'not a url', 'https://example.com/' + 'x'.repeat(480)]) assert.ok(line.publicUrlProblem(url), url);
  for (const url of ['https://example.com', 'https://example.com/base///', 'https://example.com/' + 'x'.repeat(460)])
    assert.equal(line.publicUrlProblem(url), undefined);
  assert.equal(line.webhookUrlFor('https://example.com/base///'), 'https://example.com/base/line/webhook');
});

test('the unauthenticated health route exposes only ok and has its own method guard', async t => {
  process.env.BIGNOSE_HOME = testHome(t);
  const gw = line.createLineGateway({ config: { enabled: true, port: 0, slowResponseMs: 1000, allow: { users: [], groups: [], rooms: [] } },
    accessToken: 'test-token', channelSecret: 'test-secret', onMessage: async () => '' });
  const port = await gw.listen(0); t.after(() => gw.close());
  const base = `http://127.0.0.1:${port}`;
  const res = await fetch(base + '/line/webhook/health');
  assert.equal(res.status, 200); assert.deepEqual(await res.json(), { ok: true });
  assert.equal((await fetch(base + '/line/webhook/health', { method: 'POST' })).status, 405);
  assert.equal((await fetch(base + '/line/webhook')).status, 405);
});
