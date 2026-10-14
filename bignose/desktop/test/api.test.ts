import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, createApi } from '../src/api.ts';
import type { Config } from '../src/types.ts';

type Call = { url: string; method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal | null };

function setup(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fake = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const call: Call = {
      url: String(input), method: init.method ?? 'GET', headers: init.headers as Record<string, string>,
      body: init.body as string | undefined, signal: init.signal,
    };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { api: createApi({ port: 47821, token: 'test-token', fetch: fake }), calls };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('builds URLs on 127.0.0.1 with the configured port and drops empty query values', async () => {
  const { api, calls } = setup(() => json({ sessions: [] }));
  await api.listSessions('hello world', 20);
  await api.listSessions('', undefined);
  assert.equal(calls[0].url, 'http://127.0.0.1:47821/api/sessions?q=hello+world&limit=20');
  assert.equal(calls[1].url, 'http://127.0.0.1:47821/api/sessions');
});

test('encodes path segments', async () => {
  const { api, calls } = setup(() => json({ id: 'x', title: '', messages: [] }));
  await api.getSession('a/b c');
  await api.deleteMcp('my server');
  assert.equal(calls[0].url, 'http://127.0.0.1:47821/api/sessions/a%2Fb%20c');
  assert.equal(calls[1].url, 'http://127.0.0.1:47821/api/mcp/my%20server');
  assert.equal(calls[1].method, 'DELETE');
});

test('sends the bearer token on every request and Content-Type only with a body', async () => {
  const { api, calls } = setup(() => json({ ok: true }));
  await api.status();
  await api.interrupt('s1');
  await api.putSecret('SOME_NAME', 'value');
  for (const c of calls) assert.equal(c.headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].headers['Content-Type'], undefined);
  assert.equal(calls[1].headers['Content-Type'], 'application/json');
  assert.equal(calls[2].method, 'PUT');
  assert.deepEqual(JSON.parse(calls[2].body!), { name: 'SOME_NAME', value: 'value' });
});

test('routes and bodies follow the contract', async () => {
  const { api, calls } = setup(() => json({}));
  await api.sendMessage('s1', 'hi');
  await api.decideApproval('ap1', true);
  await api.patchMcp('rea', { enabled: true });
  await api.testMcp('rea');
  await api.addSchedule({ cron: '0 9 * * *', prompt: 'p', delivery: { kind: 'desktop' } });
  await api.setScheduleEnabled('j1', false);
  await api.updateMemory(7, 'new text');
  await api.listMemory('user', 'tea');
  const seen = calls.map((c) => `${c.method} ${new URL(c.url).pathname}${new URL(c.url).search}`);
  assert.deepEqual(seen, [
    'POST /api/sessions/s1/messages', 'POST /api/approvals/ap1', 'PATCH /api/mcp/rea', 'POST /api/mcp/rea/test',
    'POST /api/schedules', 'PATCH /api/schedules/j1', 'PUT /api/memory/7', 'GET /api/memory?kind=user&q=tea',
  ]);
  assert.deepEqual(JSON.parse(calls[0].body!), { text: 'hi' });
  assert.deepEqual(JSON.parse(calls[1].body!), { allow: true });
  assert.deepEqual(JSON.parse(calls[2].body!), { enabled: true });
  assert.deepEqual(JSON.parse(calls[5].body!), { enabled: false });
});

test('maps an error body to ApiError with the daemon message', async () => {
  const { api } = setup(() => json({ error: 'bad cron' }, 400));
  await assert.rejects(api.addSchedule({ cron: 'x', prompt: 'p', delivery: { kind: 'desktop' } }), (e: unknown) => {
    assert.ok(e instanceof ApiError);
    assert.equal(e.status, 400);
    assert.equal(e.message, 'bad cron');
    return true;
  });
});

test('falls back to a readable message when the body has no error', async () => {
  const { api } = setup((c) => (c.url.endsWith('/status') ? new Response('', { status: 401 }) : new Response('<html>', { status: 500 })));
  await assert.rejects(api.status(), { name: 'ApiError', status: 401, message: 'The daemon rejected the API token' });
  await assert.rejects(api.health(), { name: 'ApiError', status: 500, message: 'HTTP 500' });
});

test('a 409 from sending a message says a run is active', async () => {
  const { api } = setup(() => new Response('', { status: 409 }));
  await assert.rejects(api.sendMessage('s', 'x'), { status: 409, message: 'A run is already active in this chat' });
});

test('maps a network failure to ApiError status 0', async () => {
  const api = createApi({ port: 1, token: 'test-token', fetch: (async () => { throw new TypeError('Load failed'); }) as typeof fetch });
  await assert.rejects(api.health(), { name: 'ApiError', status: 0, message: 'Cannot reach the BigNose daemon' });
});

test('an aborted request stays an AbortError', async () => {
  const api = createApi({ port: 1, token: 'test-token', fetch: (async () => { throw new DOMException('aborted', 'AbortError'); }) as typeof fetch });
  await assert.rejects(api.events(new AbortController().signal), { name: 'AbortError' });
});

test('events() asks for an event stream with the token and passes the signal', async () => {
  const ctl = new AbortController();
  const { api, calls } = setup(() => new Response('', { status: 200 }));
  await api.events(ctl.signal);
  assert.equal(calls[0].url, 'http://127.0.0.1:47821/api/events');
  assert.equal(calls[0].headers.Accept, 'text/event-stream');
  assert.equal(calls[0].headers.Authorization, 'Bearer test-token');
  assert.equal(calls[0].signal, ctl.signal);
});

test('updateSettings edits a fresh copy and puts the whole config back', async () => {
  const config = { version: 1, active: { provider: 'a', model: 'm' }, providers: [], line: { enabled: false } } as unknown as Config;
  const { api, calls } = setup(() => json({ config, secrets: {} }));
  await api.updateSettings((c) => { c.active = { provider: 'b', model: 'n' }; });
  assert.deepEqual(calls.map((c) => c.method), ['GET', 'PUT']);
  const sent = JSON.parse(calls[1].body!) as { config: Config };
  assert.deepEqual(sent.config.active, { provider: 'b', model: 'n' });
  assert.equal(sent.config.version, 1);
});

test('concurrent settings saves compose, and a failed save does not poison the queue', async () => {
  let stored = { version: 1, active: { provider: 'a', model: 'm' }, line: { enabled: false }, hooks: {} } as unknown as Config;
  let fail = false;
  const methods: string[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (_url, init) => {
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'PUT') {
      if (fail) { fail = false; return json({ error: 'failed' }, 500); }
      stored = JSON.parse(String(init.body)).config;
    }
    await new Promise(resolve => setImmediate(resolve));
    return json({ config: stored, secrets: {} });
  }) as typeof fetch });
  await Promise.all([
    api.updateSettings(c => { c.active.model = 'new'; }),
    api.updateSettings(c => { c.line.enabled = true; }),
  ]);
  assert.equal(stored.active.model, 'new'); assert.equal(stored.line.enabled, true);
  assert.deepEqual(methods, ['GET', 'PUT', 'GET', 'PUT']);
  fail = true;
  await assert.rejects(api.updateSettings(c => { c.active.model = 'fail'; }));
  await api.updateSettings(c => { c.active.model = 'recovered'; });
  assert.equal(stored.active.model, 'recovered');
});
