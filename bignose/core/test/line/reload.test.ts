// A LINE settings or secret save must not lose in-flight answers, queued messages, open approvals or parked "Get answer" answers.
// A real daemon, a fake LINE API (fetch), a gated fake provider and signed webhook posts; no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { TestContext } from 'node:test';
import { setSecret } from '../../src/config.ts';
import { startDaemon } from '../../src/app/daemon.ts';
import type { Config, Provider } from '../../src/types.ts';
import { configured, testHome } from '../e2e/helpers.ts';

const OWNER = 'Uowner', SECRET = 'test-secret';
interface Sent { path: string; auth: string; body: any }

async function until(cond: () => boolean, what: string) {
  for (let i = 0; i < 400; i++) { if (cond()) return; await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.fail(`timed out waiting for ${what}`);
}

type ApiHook = (path: string, init: RequestInit) => Promise<Response | undefined> | undefined;
// toolFirst: provider call 0 asks for a tool that needs a LINE approval. api: answers (or holds, or fails) a LINE API call.
// text: what an answer says (default `answer <k>`).
interface SetupOptions { toolFirst?: boolean; api?: ApiHook; text?: string }
async function setup(t: TestContext, change?: (c: Config) => void, { toolFirst = false, api, text }: SetupOptions = {}) {
  const home = testHome(t); process.env.BIGNOSE_HOME = home;
  configured(home, undefined, c => { c.line.enabled = true; c.line.allow.users = [OWNER]; c.permissions.memory_read = 'ask'; change?.(c); });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', SECRET, home);
  const sent: Sent[] = [];
  const gates = new Map<number, PromiseWithResolvers<void>>();
  let calls = 0;
  // Provider call k waits for hold(k) to be released. With toolFirst, call 0 asks for a tool (which needs a LINE approval) and
  // the next call answers.
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    const k = calls++;
    await gates.get(k)?.promise;
    if (toolFirst && k === 0) {
      yield { type: 'tool_call', id: 'c1', name: 'memory_read', input: {} };
      yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
      return;
    }
    yield { type: 'text_delta', text: text ?? `answer ${k}` };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider, lineOptions: { apiBase: 'https://line.example', fetchImpl: async (url, init = {}) => {
    const path = new URL(String(url)).pathname;
    if (path.endsWith('/reply') || path.endsWith('/push')) {
      sent.push({ path, auth: (init.headers as Record<string, string>).Authorization!, body: JSON.parse(String(init.body)) });
    }
    return await api?.(path, init) ?? Response.json({});
  } } });
  t.after(() => a.close());
  await until(() => a.lineStatus().running, 'the LINE listener');
  const call = async (path: string, method: string, body: unknown) => {
    const r = await fetch(`http://127.0.0.1:${a.port}/api/${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, 200);
  };
  let seq = 0;
  const post = async (event: object, userId = OWNER) => {
    const raw = JSON.stringify({ events: [{ webhookEventId: `e${++seq}`, replyToken: `rt-${seq}`, source: { type: 'user', userId }, ...event }] });
    const res = await fetch(`http://127.0.0.1:${a.lineStatus().port}/line/webhook`, { method: 'POST', body: raw,
      headers: { 'X-Line-Signature': createHmac('sha256', SECRET).update(raw).digest('base64') } });
    assert.equal(res.status, 200);
  };
  return {
    a, sent, call, calls: () => calls,
    hold: (k: number) => { gates.set(k, Promise.withResolvers<void>()); },
    release: (k: number) => gates.get(k)!.resolve(),
    dm: (text: string, userId?: string) => post({ type: 'message', message: { type: 'text', id: `m${seq}`, text } }, userId),
    tap: (data: string, userId?: string) => post({ type: 'postback', postback: { data } }, userId),
    // A LINE settings save through the API, as the desktop does it.
    save: (change: (c: Config) => void) => { const config = a.config(); change(config); return call('settings', 'PUT', { config }); },
    texts: () => sent.flatMap(s => s.body.messages.map((m: any) => m.text ?? m.template?.text as string)),
    buttons: () => sent.flatMap(s => s.body.messages.flatMap((m: any) => (m.template?.actions ?? []).map((x: any) => x.data as string))),
    runEnded: () => until(() => a.runtime.store.listSessions().every(s => !a.runtime.isRunning(s.id)), 'the run to end'),
  };
}

test('a LINE settings save keeps an in-flight answer', async t => {
  const s = await setup(t);
  s.hold(0);
  await s.dm('hello');
  await until(() => s.calls() === 1, 'the provider call');
  // Allow list, slow time and the access token all change while the model is still thinking.
  await s.save(c => { c.line.allow.users.push('Ufriend'); c.line.slowResponseMs = 30_000; });
  await s.call('secrets', 'PUT', { name: 'LINE_CHANNEL_ACCESS_TOKEN', value: 'test-token-2' });
  assert.equal(s.a.lineStatus().running, true);
  s.release(0);
  await until(() => s.sent.length === 1, 'the answer');
  assert.deepEqual(s.sent[0], { path: '/v2/bot/message/reply', auth: 'Bearer test-token-2',
    body: { replyToken: 'rt-1', messages: [{ type: 'text', text: 'answer 0' }] } });
  assert.equal(s.a.lineStatus().lastError, undefined);
});

test('a parked Get answer survives a LINE settings save', async t => {
  const s = await setup(t, c => { c.line.slowResponseMs = 30; });
  s.hold(0);
  await s.dm('slow question');
  await until(() => s.buttons().some(d => d.startsWith('get:')), 'the Get answer button');
  const get = s.buttons().find(d => d.startsWith('get:'))!;
  await s.save(c => { c.line.allow.rooms.push('Rroom'); });
  s.release(0);
  await s.runEnded();
  await new Promise(resolve => setTimeout(resolve, 20)); // the gateway parks the finished answer a few microtasks after the run
  await s.tap(get);
  await until(() => s.texts().includes('answer 0'), 'the parked answer');
  assert.ok(!s.texts().includes('That answer is no longer available.'));
});

test('queued LINE messages and pending approvals survive a reload', async t => {
  const s = await setup(t, undefined, { toolFirst: true });
  await s.dm('first');
  await until(() => s.buttons().some(d => d.startsWith('approve:')), 'the approval buttons');
  await s.dm('second'); // queued behind the first run, which waits for the approval
  const allow = s.buttons().find(d => d.startsWith('approve:'))!;
  await s.save(c => { c.line.slowResponseMs = 40_000; });
  await s.call('secrets', 'PUT', { name: 'LINE_CHANNEL_SECRET', value: SECRET }); // identical values still reload
  assert.equal(s.calls(), 1);
  await s.tap(allow);
  await until(() => s.texts().includes('answer 1') && s.texts().includes('answer 2'), 'both answers');
  assert.ok(s.texts().indexOf('answer 1') < s.texts().indexOf('answer 2'));
  const [session] = s.a.runtime.store.listSessions();
  assert.ok(!JSON.stringify(s.a.runtime.store.getMessages(session!.id)).includes('denied by user'));
});

test('a LINE port change moves the listener, and a busy port keeps the old one', async t => {
  const s = await setup(t, undefined, { api: path => path.endsWith('/reply') || path.endsWith('/push') ? Promise.resolve(new Response('nope', { status: 500 })) : undefined });
  await s.dm('hi'); // LINE refuses the answer, so the gateway already holds a send error
  await until(() => !!s.a.lineStatus().lastError, 'a send error');
  assert.match(s.a.lineStatus().lastError!, /500/);
  const free = () => new Promise<number>(resolve => { const x = createServer(); x.listen(0, '127.0.0.1', () => { const p = (x.address() as AddressInfo).port; x.close(() => resolve(p)); }); });
  const first = s.a.lineStatus().port, moved = await free();
  await s.save(c => { c.line.port = moved; });
  assert.equal(s.a.lineStatus().port, moved);
  await assert.rejects(fetch(`http://127.0.0.1:${first}/line/webhook/health`));
  assert.equal((await fetch(`http://127.0.0.1:${moved}/line/webhook/health`)).status, 200);
  const blocker = createServer((_req, res) => res.end());
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => { blocker.close(); blocker.closeAllConnections(); });
  await s.save(c => { c.line.port = (blocker.address() as AddressInfo).port; });
  assert.match(s.a.lineStatus().lastError!, /EADDRINUSE/);
  assert.equal(s.a.lineStatus().running, true); assert.equal(s.a.lineStatus().port, moved);
});

test('queued work of a chat removed from the allow list neither runs nor answers', async t => {
  const s = await setup(t, friends);
  s.hold(0);
  await s.dm('first', FRIEND);
  await until(() => s.calls() === 1, 'the first run');
  await s.dm('second', FRIEND); // queued behind the first
  await s.save(without);
  s.release(0);
  await s.runEnded();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(s.calls(), 1); // the second message never reached the model
  assert.equal(s.sent.length, 0); // and the removed chat got no answer, not even to the run that was in flight
  await s.dm('still allowed'); // the owner is unaffected
  await until(() => s.texts().includes('answer 1'), 'the owner answer');
  assert.deepEqual(s.sent.map(x => x.body.replyToken), ['rt-3']);
});

test('a token rotated while a request is in flight is masked in errors, old and new', async t => {
  const release = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>();
  let first = true;
  const s = await setup(t, undefined, { api: async (path, init) => {
    if (!path.endsWith('/reply') || !first) return undefined;
    first = false; arrived.resolve(); await release.promise;
    // A broken proxy that echoes the credentials it was given.
    return new Response(`bad credentials: ${(init.headers as Record<string, string>).Authorization}`, { status: 400 });
  } });
  await s.dm('hello');
  await arrived.promise; // the reply goes out with the old token
  await s.call('secrets', 'PUT', { name: 'LINE_CHANNEL_ACCESS_TOKEN', value: 'other-key-2' });
  release.resolve();
  await until(() => !!s.a.lineStatus().lastError, 'the error');
  const { lastError } = s.a.lineStatus();
  assert.match(lastError!, /400 bad credentials: Bearer \*\*\*/);
  assert.ok(!lastError!.includes('test-token') && !lastError!.includes('other-key-2'));
  await until(() => s.texts().includes('answer 0'), 'the push with the new token'); // the answer still arrives
  assert.equal(s.sent.at(-1)!.auth, 'Bearer other-key-2');
});

// A chat removed from the allow list while an answer, a prompt or a long delivery is under way must receive nothing more.
const FRIEND = 'Ufriend';
const friends = (c: Config) => { c.line.allow.users.push(FRIEND); };
const without = (c: Config) => { c.line.allow.users = c.line.allow.users.filter(u => u !== FRIEND); };
const pushes = (s: { sent: Sent[] }) => s.sent.filter(x => x.path.endsWith('/push'));

test('a refused reply does not fall back to a push for a chat removed meanwhile', async t => {
  const release = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>();
  let first = true;
  const s = await setup(t, friends, { api: async path => {
    if (!path.endsWith('/reply') || !first) return undefined;
    first = false; arrived.resolve(); await release.promise;
    return new Response('{"message":"Invalid reply token"}', { status: 400 });
  } });
  await s.dm('hello', FRIEND);
  await arrived.promise; // the reply request is in flight
  await s.save(without);
  release.resolve();
  await until(() => !!s.a.lineStatus().lastError, 'the refused reply');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(pushes(s).length, 0);
});

test('a long answer stops at the next batch once its chat was removed', async t => {
  const release = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>();
  let first = true;
  const s = await setup(t, friends, { text: 'x'.repeat(4500 * 6), api: async path => {
    if (!path.endsWith('/reply') || !first) return undefined;
    first = false; arrived.resolve(); await release.promise;
    return undefined;
  } });
  await s.dm('hello', FRIEND);
  await arrived.promise; // batch 1 (five messages) is in flight; the sixth would be a push
  await s.save(without);
  release.resolve();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(s.sent.length, 1); assert.equal(s.sent[0]!.body.messages.length, 5);
  assert.equal(pushes(s).length, 0);
});

test('a Get answer delivery stops once its chat was removed and resumes when it is back', async t => {
  const release = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>();
  let replies = 0;
  const s = await setup(t, c => { friends(c); c.line.slowResponseMs = 30; }, { text: 'x'.repeat(4500 * 6), api: async path => {
    if (!path.endsWith('/reply') || ++replies !== 2) return undefined; // 1: the working message, 2: the first batch of the answer
    arrived.resolve(); await release.promise;
    return undefined;
  } });
  s.hold(0);
  await s.dm('long one', FRIEND);
  await until(() => s.buttons().some(d => d.startsWith('get:')), 'the Get answer button');
  const get = s.buttons().find(d => d.startsWith('get:'))!;
  s.release(0);
  await s.runEnded();
  await new Promise(resolve => setTimeout(resolve, 20));
  await s.tap(get, FRIEND);
  await arrived.promise; // five of the six messages are on their way
  await s.save(without);
  release.resolve();
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(pushes(s).length, 0); // the sixth message is not sent to the removed chat
  await s.save(friends);
  await s.tap(get, FRIEND); // back on the list: the tap resumes at the remainder, on its fresh reply token
  await until(() => s.sent.length === 3, 'the remainder');
  assert.deepEqual([s.sent[2]!.path, s.sent[2]!.body.replyToken, s.sent[2]!.body.messages.length], ['/v2/bot/message/reply', 'rt-3', 1]);
  assert.equal(pushes(s).length, 0);
});

test('an approval prompt is not sent to a chat removed meanwhile, and the tool is denied', async t => {
  const s = await setup(t, friends, { toolFirst: true });
  s.hold(0);
  await s.dm('first', FRIEND);
  await until(() => s.calls() === 1, 'the run');
  await s.save(without);
  s.release(0); // the model now asks for a tool that needs approval
  await s.runEnded(); // denied at once, not after the 10-minute approval timeout
  assert.deepEqual(s.buttons(), []);
  assert.equal(s.sent.length, 0);
  const [session] = s.a.runtime.store.listSessions();
  assert.ok(JSON.stringify(s.a.runtime.store.getMessages(session!.id)).includes('denied by user'));
});

test('a fetch rejection is masked too, old token and new', async t => {
  const release = Promise.withResolvers<void>(), arrived = Promise.withResolvers<void>();
  let first = true;
  const s = await setup(t, undefined, { api: async (path, init) => {
    if (!path.endsWith('/reply') || !first) return undefined;
    first = false; arrived.resolve(); await release.promise;
    throw new Error(`connect ECONNRESET with ${(init.headers as Record<string, string>).Authorization}`);
  } });
  await s.dm('hello');
  await arrived.promise;
  await s.call('secrets', 'PUT', { name: 'LINE_CHANNEL_ACCESS_TOKEN', value: 'other-key-2' });
  release.resolve();
  await until(() => !!s.a.lineStatus().lastError, 'the error');
  const { lastError } = s.a.lineStatus();
  assert.match(lastError!, /ECONNRESET with Bearer \*\*\*/);
  assert.ok(!lastError!.includes('test-token') && !lastError!.includes('other-key-2'));
});
