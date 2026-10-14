import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { TestContext } from 'node:test';
import { createLineGateway } from '../../src/line/index.ts';
import type { LineGatewayOptions } from '../../src/line/index.ts';
import { testHome } from '../e2e/helpers.ts';

const flush = () => new Promise<void>(resolve => setImmediate(resolve));
async function until(predicate: () => boolean) {
  for (let i = 0; i < 300; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail('timed out');
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
async function setup(t: TestContext, extra: Partial<LineGatewayOptions> = {}) {
  process.env.BIGNOSE_HOME = testHome(t);
  const calls: { path: string; body: any; init: RequestInit }[] = [];
  let timer: (() => void) | undefined;
  let n = 0;
  const gw = createLineGateway({ config: { enabled: true, port: 0, slowResponseMs: 1000, allow: { users: ['Uowner'], groups: ['Cgroup'], rooms: ['Rroom'] } },
    accessToken: 'test-token', channelSecret: 'test-secret', onMessage: async () => 'answer',
    timers: { setTimeout(fn) { timer = fn; return fn; }, clearTimeout() { timer = undefined; } },
    fetchImpl: async (url, init = {}) => { calls.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init.body)), init }); return Response.json({}); },
    ...extra,
  });
  const port = await gw.listen(0); t.after(() => gw.close());
  async function post(to = 'Uowner', data?: string, id = `evt-${++n}`) {
    const source = to.startsWith('C') ? { type: 'group', groupId: to, userId: 'Uowner' }
      : to.startsWith('R') ? { type: 'room', roomId: to, userId: 'Uowner' } : { type: 'user', userId: to };
    const raw = JSON.stringify({ events: [{ webhookEventId: id, replyToken: 'reply', source,
      ...(data ? { type: 'postback', postback: { data } } : { type: 'message', message: { type: 'text', text: 'hello' } }) }] });
    const res = await fetch(`http://127.0.0.1:${port}/line/webhook`, { method: 'POST', body: raw,
      headers: { 'X-Line-Signature': createHmac('sha256', 'test-secret').update(raw).digest('base64') } });
    assert.equal(res.status, 200); await flush();
  }
  return { gw, calls, post, slow: () => { assert.ok(timer); timer(); }, deliveries: () => calls.filter(c => c.path.includes('/message/')) };
}

for (const timedOut of [false, true]) test(`cached answer resumes after ${timedOut ? 'a timed-out' : 'a failed'} second batch`, async t => {
  const answer = deferred<string>(), inFlight = deferred<void>();
  const batches: any[] = [];
  let fail = true;
  const s = await setup(t, { onMessage: () => answer.promise, fetchImpl: async (url, init = {}) => {
    const path = new URL(String(url)).pathname, body = JSON.parse(String(init.body));
    if (!path.includes('/message/')) return Response.json({});
    batches.push(body);
    if (body.messages[0]?.text?.startsWith('f') && fail) {
      if (timedOut) throw new DOMException('request timed out', 'TimeoutError');
      return new Response('offline', { status: 503 });
    }
    if (body.messages[0]?.text?.startsWith('f')) await inFlight.promise;
    return Response.json({});
  } });
  await s.post(); s.slow();
  await until(() => batches.length === 1);
  const data = batches[0].messages[0].template.actions[0].data;
  answer.resolve('abcdefg'.split('').map(c => c.repeat(4500)).join(''));
  await until(() => s.gw.status().pending[0]?.state === 'READY');
  await s.post('Uowner', data);
  await until(() => !!s.gw.status().lastError);
  assert.equal(s.gw.status().pending[0]!.state, 'READY');
  assert.deepEqual(batches[1].messages.map((m: any) => m.text[0]), ['a', 'b', 'c', 'd', 'e']);
  assert.deepEqual(batches[2].messages.map((m: any) => m.text[0]), ['f', 'g']);
  fail = false;
  await s.post('Uowner', data);
  assert.deepEqual(batches[3].messages.map((m: any) => m.text[0]), ['f', 'g']);
  assert.equal(s.gw.status().pending[0]!.state, 'READY', 'not delivered while the final batch is in flight');
  await s.post('Uowner', data);
  assert.equal(batches.length, 4, 'concurrent taps do not duplicate an in-flight delivery');
  inFlight.resolve();
  await until(() => s.gw.status().pending[0]?.state === 'DELIVERED');
  await s.post('Uowner', data);
  await until(() => batches.length === 5);
  assert.match(batches[4].messages[0].text, /already sent/);
});

test('a shared seen set dedupes across gateway instances and evicts the oldest of 2000 ids', async t => {
  const seen = new Set<string>(); let runs = 0;
  const first = await setup(t, { seen, onMessage: async () => { runs++; return 'one'; } });
  await first.post('Uowner', undefined, 'same'); await until(() => runs === 1); await first.gw.close();
  const second = await setup(t, { seen, onMessage: async () => { runs++; return 'two'; } });
  await second.post('Uowner', undefined, 'same'); assert.equal(runs, 1);
  for (let i = 0; i < 1999; i++) seen.add(`other-${i}`);
  await second.post('Uowner', undefined, 'new'); await until(() => runs === 2);
  assert.equal(seen.size, 2000); assert.equal(seen.has('same'), false);
  await second.post('Uowner', undefined, 'same'); await until(() => runs === 3);
});

test('loading is sent once per user DM run and skipped for groups, rooms and taps', async t => {
  const s = await setup(t);
  await s.post(); await until(() => s.deliveries().length === 1);
  await s.post('Cgroup'); await s.post('Rroom'); await until(() => s.deliveries().length === 3);
  await s.post('Uowner', 'get:missing'); await until(() => s.deliveries().length === 4);
  const loading = s.calls.filter(c => c.path === '/v2/bot/chat/loading/start');
  assert.equal(loading.length, 1);
  assert.deepEqual(loading[0]!.body, { chatId: 'Uowner', loadingSeconds: 60 });
  assert.equal(loading[0]!.init.method, 'POST'); assert.equal(loading[0]!.init.redirect, 'error');
  assert.equal(new Headers(loading[0]!.init.headers).get('Authorization'), 'Bearer test-token');
  assert.ok(loading[0]!.init.signal);
});

test('a hung or failing loading indicator never delays the reply or the slow-answer button and masks its error', async t => {
  const loading = deferred<Response>(), answer = deferred<string>(); let delivered = false, button = false, loadingCalls = 0;
  const s = await setup(t, { onMessage: async m => m.to === 'Uowner' ? answer.promise : 'quick', fetchImpl: async (url, init) => {
    if (String(url).endsWith('/loading/start')) { loadingCalls++; return loading.promise; }
    const body = JSON.parse(String(init?.body));
    if (body.messages[0].template) button = true; else delivered = true;
    return Response.json({});
  } });
  await s.post(); s.slow(); await until(() => button);
  answer.resolve('answer'); await until(() => s.gw.status().pending[0]?.state === 'READY');
  await s.post('Uowner', `get:${s.gw.status().pending[0]!.id}`); await until(() => delivered);
  assert.equal(loadingCalls, 1);
  loading.resolve(new Response('test-token test-secret', { status: 500 }));
  await until(() => !!s.gw.status().lastError);
  assert.match(s.gw.status().lastError!, /loading\/start failed: 500 \*\*\* \*\*\*/);
});
