import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createLineGateway } from '../../src/line/index.ts';
import type { LineGateway } from '../../src/line/index.ts';
import type { LineConfig } from '../../src/types.ts';

const SECRET = 'test-secret';
const TOKEN = 'test-token';
const OWNER = 'U1111111111111111111111111111111';
const FRIEND = 'U2222222222222222222222222222222';
const STRANGER = 'U9999999999999999999999999999999';
const GROUP = 'C3333333333333333333333333333333';
const ROOM = 'R4444444444444444444444444444444';

interface ApiCall { path: string; body: any; headers: Record<string, string> }
type Deferred = { promise: Promise<string>; resolve(v: string): void; reject(e: Error): void };

const flush = () => new Promise((r) => setImmediate(r));
async function waitFor(cond: () => boolean, what = 'condition') {
  for (let i = 0; i < 400; i++) { if (cond()) return; await new Promise((r) => setTimeout(r, 5)); }
  assert.fail(`timed out waiting for ${what}`);
}
function deferred(): Deferred {
  let resolve!: (v: string) => void, reject!: (e: Error) => void;
  const promise = new Promise<string>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

interface Opts {
  allow?: Partial<LineConfig['allow']>;
  slowResponseMs?: number;
  onMessage?: (m: { to: string; userId: string; text: string }) => Promise<string>;
  api?: (call: ApiCall) => number | undefined; // status for a LINE API call (default 200)
}

async function setup(t: { after(fn: () => void): void }, o: Opts = {}) {
  const config: LineConfig = {
    enabled: true, port: 0, slowResponseMs: o.slowResponseMs ?? 45_000,
    allow: { users: [OWNER, FRIEND], groups: [GROUP], rooms: [ROOM], ...o.allow },
  };
  const calls: ApiCall[] = [];
  const messages: { to: string; userId: string; text: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    const call: ApiCall = {
      path: new URL(url).pathname, body: JSON.parse(init.body as string),
      headers: Object.fromEntries(Object.entries(init.headers as Record<string, string>)),
    };
    calls.push(call);
    return new Response('{}', { status: o.api?.(call) ?? 200 });
  }) as unknown as typeof fetch;

  // fake clock and timers
  const clock = { t: 1_000_000 };
  const live: { id: number; at: number; fn: () => void }[] = [];
  let nextId = 1;
  const timers = {
    setTimeout: (fn: () => void, ms: number) => { const h = { id: nextId++, at: clock.t + ms, fn }; live.push(h); return h; },
    clearTimeout: (h: unknown) => { const i = live.indexOf(h as (typeof live)[number]); if (i >= 0) live.splice(i, 1); },
  };
  async function advance(ms: number) {
    clock.t += ms;
    for (;;) {
      const due = live.filter((x) => x.at <= clock.t).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      live.splice(live.indexOf(due), 1);
      due.fn();
    }
    await flush();
  }

  const gw = createLineGateway({
    config, channelSecret: SECRET, accessToken: TOKEN, fetchImpl, now: () => clock.t, timers,
    onMessage: o.onMessage ?? (async (m) => { messages.push(m); return `echo: ${m.text}`; }),
  });
  const port = await gw.listen(0);
  t.after(() => gw.close());

  const sign = (raw: string | Buffer, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('base64');
  async function post(events: unknown[], headers: Record<string, string> = {}) {
    const raw = JSON.stringify({ destination: 'Ubot', events });
    return fetch(`http://127.0.0.1:${port}/line/webhook`, {
      method: 'POST', body: raw, headers: { 'Content-Type': 'application/json', 'X-Line-Signature': sign(raw), ...headers },
    });
  }
  let n = 0;
  const source = (who: string) => (who.startsWith('C') ? { type: 'group', groupId: who, userId: FRIEND }
    : who.startsWith('R') ? { type: 'room', roomId: who, userId: FRIEND } : { type: 'user', userId: who });
  const text = (who: string, body: string, extra: Record<string, unknown> = {}) => ({
    type: 'message', webhookEventId: `evt-${++n}`, replyToken: `rt-${n}`, timestamp: clock.t, source: source(who),
    message: { type: 'text', id: String(n), text: body }, ...extra,
  });
  const tap = (who: string, data: string, byUser?: string) => ({
    type: 'postback', webhookEventId: `evt-${++n}`, replyToken: `rt-${n}`, timestamp: clock.t,
    source: { ...source(who), ...(byUser ? { userId: byUser } : {}) }, postback: { data },
  });
  const replies = () => calls.filter((c) => c.path === '/v2/bot/message/reply');
  const pushes = () => calls.filter((c) => c.path === '/v2/bot/message/push');
  const texts = (c: ApiCall) => (c.body.messages as any[]).map((m) => m.text as string);
  return { gw, port, config, calls, messages, post, text, tap, sign, advance, clock, replies, pushes, texts, live };
}

// ---- webhook HTTP

test('signature: good → 200, bad or missing → 401; events: [] → 200', async (t) => {
  const s = await setup(t);
  assert.equal((await s.post([])).status, 200, 'console verify');
  assert.equal((await s.post([s.text(OWNER, 'hi')])).status, 200);
  const raw = JSON.stringify({ events: [s.text(OWNER, 'sneaky')] });
  const url = `http://127.0.0.1:${s.port}/line/webhook`;
  assert.equal((await fetch(url, { method: 'POST', body: raw, headers: { 'X-Line-Signature': s.sign(raw, 'wrong-secret') } })).status, 401, 'wrong secret');
  assert.equal((await fetch(url, { method: 'POST', body: raw })).status, 401, 'missing header');
  assert.equal((await fetch(url, { method: 'POST', body: raw, headers: { 'X-Line-Signature': '' } })).status, 401, 'empty header');
  assert.equal((await fetch(url, { method: 'POST', body: raw, headers: { 'X-Line-Signature': s.sign(raw + ' ') } })).status, 401, 'signature of other bytes');
  assert.equal((await fetch(url, { method: 'POST', body: raw, headers: { 'X-Line-Signature': 'short' } })).status, 401, 'wrong length');
  await flush();
  assert.deepEqual(s.messages.map((m) => m.text), ['hi'], 'unsigned requests never reach onMessage');
});

test('other routes and bad bodies', async (t) => {
  const s = await setup(t);
  const base = `http://127.0.0.1:${s.port}`;
  assert.equal((await fetch(`${base}/line/webhook`)).status, 405);
  assert.equal((await fetch(`${base}/other`, { method: 'POST', body: '{}' })).status, 404);
  assert.equal((await fetch(`${base}/line/webhook?x=1`, { method: 'POST', body: '{}', headers: { 'X-Line-Signature': s.sign('{}') } })).status, 200, 'query string is ignored');
  assert.equal((await fetch(`${base}/line/webhook`, { method: 'POST', body: 'not json', headers: { 'X-Line-Signature': s.sign('not json') } })).status, 400);
  assert.equal((await fetch(`${base}/line/webhook`, { method: 'POST', body: '{"events":"nope"}', headers: { 'X-Line-Signature': s.sign('{"events":"nope"}') } })).status, 200);
  assert.equal((await fetch(`${base}/line/webhook`, { method: 'POST', body: 'null', headers: { 'X-Line-Signature': s.sign('null') } })).status, 200);
});

test('a body over 1 MiB → 413, at the limit is accepted', async (t) => {
  const s = await setup(t);
  const url = `http://127.0.0.1:${s.port}/line/webhook`;
  const big = Buffer.alloc(1024 * 1024 + 1, 'a');
  const r = await fetch(url, { method: 'POST', body: big, headers: { 'X-Line-Signature': s.sign(big) } });
  assert.equal(r.status, 413);
  const huge = Buffer.alloc(3 * 1024 * 1024, 'a'); // far over: still gets a clean 413
  assert.equal((await fetch(url, { method: 'POST', body: huge, headers: { 'X-Line-Signature': s.sign(huge) } })).status, 413);

  // no Content-Length (chunked) is cut off by the running count
  const status = await new Promise<number>((resolve, reject) => {
    const req = http.request(url, { method: 'POST', headers: { 'Transfer-Encoding': 'chunked' } }, (res) => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject);
    for (let i = 0; i < 20; i++) req.write(Buffer.alloc(100 * 1024, 'b'));
    req.end();
  });
  assert.equal(status, 413);

  const edge = Buffer.from(JSON.stringify({ events: [] }).padEnd(1024 * 1024, ' '));
  assert.equal(edge.length, 1024 * 1024);
  assert.equal((await fetch(url, { method: 'POST', body: edge, headers: { 'X-Line-Signature': s.sign(edge) } })).status, 200);
  assert.equal(s.messages.length, 0);
});

test('webhookEventId is deduped', async (t) => {
  const s = await setup(t);
  const e = s.text(OWNER, 'once');
  await s.post([e]);
  await waitFor(() => s.replies().length === 1);
  await s.post([e]); // LINE redelivery
  await s.post([e, e]);
  await flush();
  assert.equal(s.messages.length, 1);
  await s.post([{ ...e, webhookEventId: 'different' }]);
  await waitFor(() => s.messages.length === 2);
});

// ---- allowlists

test('allowlist: strangers get no reply and no work (deny by default)', async (t) => {
  const s = await setup(t);
  await s.post([
    s.text(STRANGER, 'let me in'),
    s.text('Cunknowngroup00000000000000000000', 'hi group'),
    s.text('Runknownroom000000000000000000000', 'hi room'),
    { ...s.text(OWNER, 'no source'), source: undefined },
    { ...s.text(OWNER, 'no user id'), source: { type: 'user' } },
    { ...s.text(OWNER, 'weird source'), source: { type: 'bot', userId: OWNER } },
    s.tap(STRANGER, 'get:abc'),
    s.tap(STRANGER, 'approve:abc'),
  ]);
  await flush();
  await flush();
  assert.equal(s.calls.length, 0, 'no LINE API call for strangers');
  assert.equal(s.messages.length, 0);
});

test('allowlist: empty lists deny everyone', async (t) => {
  const s = await setup(t, { allow: { users: [], groups: [], rooms: [] } });
  await s.post([s.text(OWNER, 'a'), s.text(GROUP, 'b'), s.text(ROOM, 'c')]);
  await flush();
  assert.equal(s.calls.length, 0);
  assert.equal(s.messages.length, 0);
});

test('allowlist: users, groups and rooms reach onMessage with chat, sender and text', async (t) => {
  const s = await setup(t);
  await s.post([s.text(OWNER, 'from owner'), s.text(GROUP, 'from group'), s.text(ROOM, 'from room')]);
  await waitFor(() => s.messages.length === 3);
  const by = (text: string) => s.messages.find((m) => m.text === text)!;
  assert.deepEqual(by('from owner'), { to: OWNER, userId: OWNER, text: 'from owner' });
  assert.deepEqual(by('from group'), { to: GROUP, userId: FRIEND, text: 'from group' }, 'group chat id is the target, sender is kept');
  assert.deepEqual(by('from room'), { to: ROOM, userId: FRIEND, text: 'from room' });
  await waitFor(() => s.replies().length === 3);
});

test('a group member outside allow.users still works in an allowlisted group; the sender is passed on', async (t) => {
  const s = await setup(t, { allow: { users: [OWNER] } });
  await s.post([{ ...s.text(GROUP, 'hello'), source: { type: 'group', groupId: GROUP, userId: STRANGER } }]);
  await waitFor(() => s.messages.length === 1);
  assert.equal(s.messages[0]!.userId, STRANGER);
  assert.equal(s.messages[0]!.to, GROUP);
  await post1(s, { ...s.text(GROUP, 'no id'), source: { type: 'group', groupId: GROUP } });
  await waitFor(() => s.messages.length === 2);
  assert.equal(s.messages[1]!.userId, '', 'unknown sender → empty userId');
});
const post1 = (s: Awaited<ReturnType<typeof setup>>, e: unknown) => s.post([e]);

test('only text messages are processed', async (t) => {
  const s = await setup(t);
  await s.post([
    { ...s.text(OWNER, ''), message: { type: 'image', id: '1' } },
    { type: 'follow', webhookEventId: 'f1', replyToken: 'rt', source: { type: 'user', userId: OWNER } },
    { type: 'postback', webhookEventId: 'p1', replyToken: 'rt', source: { type: 'user', userId: OWNER }, postback: {} },
    { ...s.text(OWNER, ''), message: { type: 'text', id: '1' } },
  ]);
  await flush();
  assert.equal(s.messages.length, 0);
  assert.equal(s.calls.length, 0);
});

// ---- sending

test('reply token is used first (single use), with the bearer token', async (t) => {
  const s = await setup(t);
  await s.post([s.text(OWNER, 'hello')]);
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/reply');
  assert.deepEqual(s.calls[0]!.body, { replyToken: 'rt-1', messages: [{ type: 'text', text: 'echo: hello' }] });
  assert.equal(s.calls[0]!.headers.Authorization, `Bearer ${TOKEN}`);
  assert.equal(s.calls[0]!.headers['Content-Type'], 'application/json');
  assert.equal(s.pushes().length, 0);
});

test('an expired reply token falls back to push', async (t) => {
  const answer = deferred();
  const s = await setup(t, { onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'slow-ish')]);
  await waitFor(() => s.live.length === 1); // the slow-response timer is armed, so the run has started
  s.clock.t += 56_000; // token older than ~55 s, but under slowResponseMs
  answer.resolve('late answer');
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/push');
  assert.deepEqual(s.calls[0]!.body, { to: OWNER, messages: [{ type: 'text', text: 'late answer' }] });
  assert.equal(s.replies().length, 0, 'the stale token is not even tried');
});

test('a failed reply (LINE rejects the token) falls back to push with the same messages', async (t) => {
  const s = await setup(t, { api: (c) => (c.path.endsWith('/reply') ? 400 : 200) });
  await s.post([s.text(OWNER, 'hello')]);
  await waitFor(() => s.calls.length === 2);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[1]!.path, '/v2/bot/message/push');
  assert.deepEqual(s.calls[1]!.body, { to: OWNER, messages: s.calls[0]!.body.messages });
  assert.match(s.gw.status().lastError!, /reply failed: 400/);
});

test('every reply token is used once: the second answer in a chat has no token and is pushed', async (t) => {
  const s = await setup(t);
  await s.post([s.text(OWNER, 'one')]);
  await waitFor(() => s.calls.length === 1);
  await s.gw.push(OWNER, 'extra'); // no unused token left
  assert.deepEqual(s.calls.map((c) => c.path), ['/v2/bot/message/reply', '/v2/bot/message/push']);
});

test('text is chunked at 4500 characters, at most 5 messages per call', async (t) => {
  const s = await setup(t);
  const sendLen = async (len: number) => {
    s.calls.length = 0;
    const body = 'x'.repeat(len);
    await s.gw.push(OWNER, body);
    return s.calls.map((c) => (c.body.messages as any[]).map((m) => m.text as string));
  };
  assert.deepEqual((await sendLen(4500)).map((c) => c.map((m) => m.length)), [[4500]]);
  assert.deepEqual((await sendLen(4501)).map((c) => c.map((m) => m.length)), [[4500, 1]]);
  assert.deepEqual((await sendLen(22_500)).map((c) => c.map((m) => m.length)), [[4500, 4500, 4500, 4500, 4500]], 'exactly 5 messages: one call');
  const six = await sendLen(22_501);
  assert.deepEqual(six.map((c) => c.map((m) => m.length)), [[4500, 4500, 4500, 4500, 4500], [1]], 'sixth chunk goes in a further call');
  const eleven = await sendLen(4500 * 10 + 1);
  assert.deepEqual(eleven.map((c) => c.length), [5, 5, 1]);
  assert.ok(s.calls.every((c) => c.path === '/v2/bot/message/push'), 'no token: all pushes');

});

test('a long answer: first 5 messages by reply, the rest by push, nothing lost', async (t) => {
  const original = Array.from({ length: 7 }, (_, i) => String.fromCharCode(97 + i).repeat(4500)).join('') + 'tail';
  const s = await setup(t, { onMessage: async () => original });
  await s.post([s.text(OWNER, 'long please')]);
  await waitFor(() => s.calls.length === 2);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[0]!.body.messages.length, 5);
  assert.equal(s.calls[1]!.path, '/v2/bot/message/push');
  assert.equal(s.calls[1]!.body.messages.length, 3);
  const all = s.calls.flatMap((c) => s.texts(c));
  assert.ok(all.every((m) => m.length <= 4500));
  assert.equal(all.join(''), original);
});

test('chunking never splits a surrogate pair', async (t) => {
  const s = await setup(t);
  const body = 'a'.repeat(4499) + '😀' + 'b'.repeat(10);
  await s.gw.push(OWNER, body);
  const parts = s.texts(s.calls[0]!);
  assert.deepEqual(parts.map((p) => p.length), [4499, 12]);
  assert.equal(parts.join(''), body);
  assert.ok(parts[1]!.startsWith('😀'));
});

test('an empty answer is replaced by a placeholder (LINE rejects empty text)', async (t) => {
  const s = await setup(t, { onMessage: async () => '' });
  await s.post([s.text(OWNER, 'say nothing')]);
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.texts(s.calls[0]!)[0], '(empty reply)');
});

test('onMessage failing sends a short apology, keeps the error for status, and the chat keeps working', async (t) => {
  let n = 0;
  const s = await setup(t, { onMessage: async (m) => { if (++n === 1) throw new Error(`provider exploded with ${TOKEN}`); return `ok ${m.text}`; } });
  await s.post([s.text(OWNER, 'one')]);
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.texts(s.calls[0]!)[0], 'Sorry, something went wrong.');
  assert.match(s.gw.status().lastError!, /provider exploded/);
  assert.doesNotMatch(s.gw.status().lastError!, new RegExp(TOKEN), 'credentials are scrubbed from the status');
  await s.post([s.text(OWNER, 'two')]);
  await waitFor(() => s.calls.length === 2);
  assert.equal(s.texts(s.calls[1]!)[0], 'ok two');
});

// ---- slow response

test('slow response: Get answer button, PENDING → READY → DELIVERED', async (t) => {
  const answer = deferred();
  const s = await setup(t, { slowResponseMs: 45_000, onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'think hard')]);
  await waitFor(() => s.live.length === 1);
  assert.equal(s.calls.length, 0, 'nothing is sent before the threshold');

  await s.advance(45_000);
  await waitFor(() => s.calls.length === 1);
  // the first reply token carries the button
  assert.equal(s.calls[0]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[0]!.body.replyToken, 'rt-1');
  const msg = s.calls[0]!.body.messages[0];
  assert.equal(msg.type, 'template');
  assert.equal(msg.template.type, 'buttons');
  assert.ok(msg.template.text.length <= 160);
  const action = msg.template.actions[0];
  assert.equal(action.type, 'postback');
  assert.equal(action.label, 'Get answer');
  assert.match(action.data, /^get:[0-9a-f]{12}$/);
  const id = action.data.slice(4);
  assert.deepEqual(s.gw.status().pending, [{ id, to: OWNER, state: 'PENDING' }]);

  // a tap while still PENDING: "still working" again, with the button, on the tap's fresh token
  await s.post([s.tap(OWNER, action.data)]);
  await waitFor(() => s.calls.length === 2);
  assert.equal(s.calls[1]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[1]!.body.replyToken, 'rt-2');
  assert.equal(s.calls[1]!.body.messages[0].template.actions[0].data, action.data);
  assert.equal(s.gw.status().pending[0]!.state, 'PENDING');

  // the answer completes: READY, nothing is pushed
  answer.resolve('the final answer');
  await waitFor(() => s.gw.status().pending[0]!.state === 'READY');
  assert.equal(s.calls.length, 2);
  assert.equal(s.pushes().length, 0, 'READY costs nothing; the tap pays with a free reply token');

  // the tap delivers it with its own new reply token
  await s.post([s.tap(OWNER, action.data)]);
  await waitFor(() => s.calls.length === 3);
  assert.equal(s.calls[2]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[2]!.body.replyToken, 'rt-3');
  assert.deepEqual(s.texts(s.calls[2]!), ['the final answer']);
  assert.equal(s.gw.status().pending[0]!.state, 'DELIVERED');
  assert.equal(s.pushes().length, 0);

  // another tap does not resend it
  await s.post([s.tap(OWNER, action.data)]);
  await waitFor(() => s.calls.length === 4);
  assert.match(s.texts(s.calls[3]!)[0]!, /already sent/);
});

test('a quick answer sends no button and cancels the slow timer', async (t) => {
  const answer = deferred();
  const s = await setup(t, { onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'quick')]);
  await waitFor(() => s.live.length === 1);
  answer.resolve('fast');
  await waitFor(() => s.calls.length === 1);
  assert.deepEqual(s.texts(s.calls[0]!), ['fast']);
  assert.equal(s.live.length, 0, 'slow timer cleared');
  await s.advance(60_000);
  assert.equal(s.calls.length, 1);
  assert.deepEqual(s.gw.status().pending, []);
});

test('slow answer delivered by tap is chunked too (first call by reply, rest by push)', async (t) => {
  const answer = deferred();
  const s = await setup(t, { slowResponseMs: 1000, onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'q')]);
  await waitFor(() => s.live.length === 1);
  await s.advance(1000);
  await waitFor(() => s.calls.length === 1);
  const data = s.calls[0]!.body.messages[0].template.actions[0].data as string;
  const long = 'z'.repeat(4500 * 6);
  answer.resolve(long);
  await waitFor(() => s.gw.status().pending[0]!.state === 'READY');
  await s.post([s.tap(OWNER, data)]);
  await waitFor(() => s.calls.length === 3);
  assert.equal(s.calls[1]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[1]!.body.messages.length, 5);
  assert.equal(s.calls[2]!.path, '/v2/bot/message/push');
  assert.equal(s.calls[2]!.body.messages.length, 1);
});

test('taps: unknown id, wrong chat and malformed data are handled quietly', async (t) => {
  const answer = deferred();
  const s = await setup(t, { slowResponseMs: 1000, onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'q')]);
  await waitFor(() => s.live.length === 1);
  await s.advance(1000);
  await waitFor(() => s.calls.length === 1);
  const id = (s.calls[0]!.body.messages[0].template.actions[0].data as string).slice(4);
  answer.resolve('secret answer');
  await waitFor(() => s.gw.status().pending[0]!.state === 'READY');

  await s.post([s.tap(OWNER, 'get:doesnotexist')]);
  await waitFor(() => s.calls.length === 2);
  assert.match(s.texts(s.calls[1]!)[0]!, /no longer available/);

  await s.post([s.tap(GROUP, `get:${id}`)]); // another chat cannot take the answer
  await waitFor(() => s.calls.length === 3);
  assert.match(s.texts(s.calls[2]!)[0]!, /no longer available/);
  assert.equal(s.gw.status().pending[0]!.state, 'READY');

  await s.post([s.tap(OWNER, 'garbage'), s.tap(OWNER, ''), s.tap(OWNER, 'nope:1')]);
  await flush();
  await flush();
  assert.equal(s.calls.length, 3, 'unknown actions do nothing');
});

test('slow button is sent by push when the reply token is already stale', async (t) => {
  const answer = deferred();
  const s = await setup(t, { slowResponseMs: 60_000, onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'q')]);
  await waitFor(() => s.live.length === 1);
  await s.advance(60_000); // threshold above the token lifetime (misconfiguration): fall back to push
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/push');
  assert.equal(s.calls[0]!.body.messages[0].template.type, 'buttons');
});

// ---- approvals

test('askApproval: confirm template, Allow → true, Deny → false', async (t) => {
  const s = await setup(t);
  const allow = s.gw.askApproval(OWNER, 'Run `ls -la` in /tmp?');
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/push');
  const m = s.calls[0]!.body.messages[0];
  assert.equal(m.type, 'template');
  assert.equal(m.template.type, 'confirm');
  assert.equal(m.template.text, 'Run `ls -la` in /tmp?');
  assert.deepEqual(m.template.actions.map((a: any) => [a.type, a.label]), [['postback', 'Allow'], ['postback', 'Deny']]);
  const [yes, no] = m.template.actions.map((a: any) => a.data as string);
  assert.match(yes, /^approve:[0-9a-f]{12}$/);
  assert.equal(no, yes.replace('approve:', 'deny:'));
  await s.post([s.tap(OWNER, yes)]);
  assert.equal(await allow, true);

  const deny = s.gw.askApproval(OWNER, 'Delete everything?');
  await waitFor(() => s.calls.length === 2);
  await s.post([s.tap(OWNER, s.calls[1]!.body.messages[0].template.actions[1].data)]);
  assert.equal(await deny, false);
});

test('askApproval mid-run: the confirm buttons use the young reply token, the tap\'s token carries the answer', async (t) => {
  const answer = deferred();
  const s = await setup(t, { onMessage: () => answer.promise });
  await s.post([s.text(OWNER, 'please run it')]);
  await waitFor(() => s.live.length === 1); // the run has started
  const p = s.gw.askApproval(OWNER, 'Run `date`?');
  await waitFor(() => s.calls.length === 1);
  assert.equal(s.calls[0]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[0]!.body.replyToken, 'rt-1');
  assert.equal(s.calls[0]!.body.messages[0].template.type, 'confirm');
  await s.post([s.tap(OWNER, s.calls[0]!.body.messages[0].template.actions[0].data)]);
  assert.equal(await p, true);
  answer.resolve('it is noon');
  await waitFor(() => s.calls.length === 2);
  assert.equal(s.calls[1]!.path, '/v2/bot/message/reply');
  assert.equal(s.calls[1]!.body.replyToken, 'rt-2', 'the tap left a fresh token for the answer');
  assert.deepEqual(s.texts(s.calls[1]!), ['it is noon']);
});

test('askApproval: taps from non-allowlisted users, other chats or with unknown ids are ignored', async (t) => {
  const s = await setup(t, { allow: { users: [OWNER] } });
  const p = s.gw.askApproval(GROUP, 'Allow it?');
  await waitFor(() => s.calls.length === 1);
  const yes = s.calls[0]!.body.messages[0].template.actions[0].data as string;
  let settled: boolean | undefined;
  void p.then((v) => { settled = v; });

  await s.post([s.tap(GROUP, yes, STRANGER)]); // group member outside allow.users
  await s.post([s.tap(OWNER, yes)]);            // right user, wrong chat
  await s.post([s.tap(GROUP, 'approve:unknown', OWNER)]);
  await s.post([s.tap(GROUP, yes, FRIEND)]);    // FRIEND is not in allow.users here
  await flush();
  await flush();
  assert.equal(settled, undefined, 'still waiting');

  await s.post([s.tap(GROUP, yes, OWNER)]);
  assert.equal(await p, true);
  await s.post([s.tap(GROUP, yes, OWNER)]); // a second tap changes nothing
  await flush();
});

test('askApproval: first tap wins; times out to deny after 10 minutes', async (t) => {
  const s = await setup(t);
  const p = s.gw.askApproval(OWNER, 'Allow?');
  await waitFor(() => s.calls.length === 1);
  const [yes, no] = s.calls[0]!.body.messages[0].template.actions.map((a: any) => a.data as string);
  await s.post([s.tap(OWNER, yes), s.tap(OWNER, no)]);
  assert.equal(await p, true, 'first tap wins');

  const timeout = s.gw.askApproval(OWNER, 'Allow again?');
  await waitFor(() => s.calls.length === 2);
  await s.advance(10 * 60_000 - 1);
  let settled: boolean | undefined;
  void timeout.then((v) => { settled = v; });
  await flush();
  assert.equal(settled, undefined);
  await s.advance(1);
  assert.equal(await timeout, false, 'no answer in 10 minutes = deny');
  assert.equal(s.live.length, 0);
});

test('askApproval: a long prompt is sent in full before the buttons; send failure denies; close denies', async (t) => {
  const s = await setup(t);
  const command = `rm -rf ${'/very/long/path'.repeat(40)} && echo done`;
  const p = s.gw.askApproval(OWNER, command);
  await waitFor(() => s.calls.length === 1);
  const messages = s.calls[0]!.body.messages as any[];
  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, command, 'whole command visible');
  assert.equal(messages[1].template.type, 'confirm');
  assert.ok(messages[1].template.text.length <= 240);
  assert.ok(messages[1].altText.length <= 400);
  await s.gw.close();
  assert.equal(await p, false);

  const s2 = await setup(t, { api: () => 500 });
  assert.equal(await s2.gw.askApproval(OWNER, 'will not arrive'), false, 'cannot ask → deny, not hang');
});

// ---- queue

test('one run per chat: later messages wait and keep their order; chats are independent', async (t) => {
  const gates = new Map<string, Deferred>();
  const started: string[] = [];
  const s = await setup(t, {
    onMessage: (m) => { started.push(m.text); const d = deferred(); gates.set(m.text, d); return d.promise; },
  });
  await s.post([s.text(OWNER, 'a1'), s.text(OWNER, 'a2'), s.text(OWNER, 'a3'), s.text(GROUP, 'g1')]);
  await waitFor(() => started.length === 2);
  assert.deepEqual(started.sort(), ['a1', 'g1'], 'a2 and a3 wait; the other chat runs right away');
  await flush();
  assert.equal(started.length, 2);

  gates.get('a1')!.resolve('A1');
  await waitFor(() => started.includes('a2'));
  assert.equal(started.includes('a3'), false);
  gates.get('g1')!.resolve('G1');
  gates.get('a2')!.resolve('A2');
  await waitFor(() => started.includes('a3'));
  gates.get('a3')!.resolve('A3');
  await waitFor(() => s.calls.length === 4);
  const order = s.calls.flatMap((c) => s.texts(c)).filter((x) => /^A\d$/.test(x));
  assert.deepEqual(order, ['A1', 'A2', 'A3']);
  assert.deepEqual(started.filter((x) => x.startsWith('a')), ['a1', 'a2', 'a3']);
});

test('a slow run parks its answer and the chat moves on to the next message', async (t) => {
  const first = deferred();
  const s = await setup(t, {
    slowResponseMs: 1000,
    onMessage: async (m) => (m.text === 'slow' ? first.promise : `fast: ${m.text}`),
  });
  await s.post([s.text(OWNER, 'slow'), s.text(OWNER, 'next')]);
  await waitFor(() => s.live.length === 1);
  await s.advance(1000);
  await waitFor(() => s.calls.length === 1); // the button
  first.resolve('slow answer');
  await waitFor(() => s.calls.length === 2); // 'next' runs once the slow run has finished
  assert.equal(s.texts(s.calls[1]!)[0], 'fast: next');
});

// ---- push / status / lifecycle

test('push() chunks and sends; status() reports state; close() stops the server', async (t) => {
  const s = await setup(t);
  assert.deepEqual(s.gw.status(), { running: true, port: s.port, lastEventAt: undefined, lastError: undefined, pending: [] });
  await s.post([]);
  assert.equal(s.gw.status().lastEventAt, s.clock.t);
  await s.gw.push(OWNER, 'cron says hi');
  assert.deepEqual(s.calls[0]!.body, { to: OWNER, messages: [{ type: 'text', text: 'cron says hi' }] });
  await s.gw.close();
  assert.equal(s.gw.status().running, false);
  await assert.rejects(fetch(`http://127.0.0.1:${s.port}/line/webhook`, { method: 'POST', body: '{}' }));
  await s.gw.close(); // idempotent
});

test('push() throws when LINE refuses, so callers (cron delivery) can report it', async (t) => {
  const s = await setup(t, { api: () => 429 });
  await assert.rejects(s.gw.push(OWNER, 'x'), /429/);
});

test('listening twice is an error', async (t) => {
  const s = await setup(t);
  await assert.rejects(s.gw.listen(0), /already listening/);
});

test('real HTTP LINE API: apiBase works with the default fetch', async (t) => {
  const seen: { url: string; auth: string | undefined; body: any }[] = [];
  const api = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => { seen.push({ url: req.url!, auth: req.headers.authorization, body: JSON.parse(raw) }); res.end('{}'); });
  });
  await new Promise<void>((r) => api.listen(0, '127.0.0.1', r));
  t.after(() => { api.closeAllConnections(); api.close(); });
  const gw: LineGateway = createLineGateway({
    config: { enabled: true, port: 0, slowResponseMs: 45_000, allow: { users: [OWNER], groups: [], rooms: [] } },
    channelSecret: SECRET, accessToken: TOKEN, apiBase: `http://127.0.0.1:${(api.address() as AddressInfo).port}/`,
    onMessage: async (m) => `got ${m.text}`,
  });
  const port = await gw.listen(0);
  t.after(() => gw.close());
  const raw = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'e1', replyToken: 'rt', source: { type: 'user', userId: OWNER }, message: { type: 'text', id: '1', text: 'ping' } }] });
  const res = await fetch(`http://127.0.0.1:${port}/line/webhook`, { method: 'POST', body: raw, headers: { 'X-Line-Signature': createHmac('sha256', SECRET).update(raw).digest('base64') } });
  assert.equal(res.status, 200);
  await waitFor(() => seen.length === 1);
  assert.deepEqual(seen[0], { url: '/v2/bot/message/reply', auth: `Bearer ${TOKEN}`, body: { replyToken: 'rt', messages: [{ type: 'text', text: 'got ping' }] } });
});
