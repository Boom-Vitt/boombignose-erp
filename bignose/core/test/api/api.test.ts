import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, request as httpRequest } from 'node:http';
import type { TestContext } from 'node:test';
import { startDaemon } from '../../src/app/daemon.ts';
import type { DaemonOptions } from '../../src/app/daemon.ts';
import { maskSecret, paths, readEnv, setSecret, loadConfig } from '../../src/config.ts';
import type { Config, Provider } from '../../src/types.ts';
import { createCleaner, safeValue } from '../../src/app/settings.ts';
import { configured, mockOpenai, testHome, toolCall } from '../e2e/helpers.ts';

type App = Awaited<ReturnType<typeof startDaemon>>;
async function app(t: TestContext, options: DaemonOptions = {}, change?: (c: Config) => void) {
  const home = options.home ?? testHome(t);
  if (!options.home) configured(home, undefined, change);
  const daemon = await startDaemon({ ...options, home }); t.after(() => daemon.close());
  return daemon;
}
async function call(a: App, path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) {
  if (headers.Host) return new Promise<{ status: number; headers: Headers; body: any }>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: a.port, path, method, headers: { Authorization: `Bearer ${a.token}`, ...headers } }, res => {
      let raw = ''; res.on('data', c => { raw += c; });
      res.on('end', () => resolve({ status: res.statusCode!, headers: new Headers(Object.fromEntries(Object.entries(res.headers).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))), body: raw ? JSON.parse(raw) : undefined }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const res = await fetch(`http://127.0.0.1:${a.port}${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: res.status === 204 ? undefined : await res.json() as any };
}
async function events(a: App, t: TestContext) {
  const controller = new AbortController();
  const res = await fetch(`http://127.0.0.1:${a.port}/api/events`, { headers: { Authorization: `Bearer ${a.token}` }, signal: controller.signal });
  assert.equal(res.status, 200); assert.match(res.headers.get('content-type')!, /text\/event-stream/);
  const values: any[] = [];
  const waiters = new Set<() => void>();
  const reader = res.body!.getReader();
  const drained = (async () => {
    const decoder = new TextDecoder(); let buffer = '';
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        let i: number;
        while ((i = buffer.indexOf('\n\n')) >= 0) {
          const line = buffer.slice(0, i); buffer = buffer.slice(i + 2);
          if (line.startsWith('data: ')) { values.push(JSON.parse(line.slice(6))); for (const notify of waiters) notify(); }
        }
      }
    } catch (e) { if (!controller.signal.aborted) throw e; }
  })();
  const close = async () => { controller.abort(); await drained; };
  t.after(close);
  return {
    values, close,
    wait(predicate: (e: any) => boolean): Promise<any> {
      const existing = values.find(predicate); if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { waiters.delete(notify); reject(new Error('event timed out')); }, 5000);
        const notify = () => { const found = values.find(predicate); if (found) { clearTimeout(timer); waiters.delete(notify); resolve(found); } };
        waiters.add(notify); notify();
      });
    },
  };
}
const fakeMcp = { transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('../mcp/fake-server.ts', import.meta.url))], env: { BN_TEST: '${VALUE}' }, enabled: true };

test('every section 6 CRUD/status route has the documented JSON shape, auth, Host and Tauri CORS', async t => {
  const a = await app(t);
  const url = `http://127.0.0.1:${a.port}`;
  assert.equal((await fetch(url + '/api/health')).status, 401);
  assert.equal((await call(a, '/api/health', 'GET', undefined, { Authorization: 'Bearer wrong' })).status, 401);
  assert.equal((await call(a, '/api/health', 'GET', undefined, { Host: 'foreign.invalid' })).status, 403);
  assert.equal((await call(a, '/api/health', 'GET', undefined, { Host: `localhost:${a.port}` })).status, 200);
  for (const origin of ['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']) {
    const preflight = await fetch(url + '/api/settings', { method: 'OPTIONS', headers: { Origin: origin } });
    assert.equal(preflight.status, 204); assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
    assert.equal(preflight.headers.get('access-control-allow-methods'), 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    assert.equal(preflight.headers.get('access-control-allow-headers'), 'Authorization, Content-Type');
    assert.equal(preflight.headers.get('access-control-max-age'), '600');
    const get = await call(a, '/api/health', 'GET', undefined, { Origin: origin });
    assert.equal(get.headers.get('access-control-allow-origin'), origin); assert.equal(get.headers.get('vary'), 'Origin');
    assert.equal((await call(a, '/api/memory', 'POST', {}, { Origin: origin })).headers.get('access-control-allow-origin'), origin);
  }
  assert.equal((await call(a, '/api/health', 'GET', undefined, { Origin: 'https://foreign.invalid' })).headers.get('access-control-allow-origin'), null);
  assert.equal((await call(a, '/api/settings', 'OPTIONS', undefined, { Host: 'foreign.invalid', Origin: 'tauri://localhost' })).status, 403);
  assert.deepEqual((await call(a, '/api/health')).body, { ok: true, version: '0.1.0', pid: process.pid });
  assert.deepEqual((await call(a, '/api/status')).body, { version: '0.1.0', provider: { id: 'mock', kind: 'openai-compatible', model: 'test-model' }, line: { enabled: false, running: false },
    mcp: [{ name: 'rea', enabled: false, connected: false, tools: 0 }], schedules: 0 });
  const line = (await call(a, '/api/line/status')).body;
  assert.deepEqual(line, { enabled: false, running: false, port: 0, agentId: a.runtime.store.listAgents()[0]!.id, tokenSet: false, secretSet: false,
    warnings: ['Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.'] });
  assert.equal('pending' in line, false);

  const sid = (await call(a, '/api/sessions', 'POST', { title: 'test title' })).body.id;
  assert.deepEqual((await call(a, `/api/sessions/${sid}`)).body, { id: sid, agentId: a.runtime.store.listAgents()[0]!.id, title: 'test title', messages: [], notices: [], live: null });
  const sessions = (await call(a, '/api/sessions?limit=1')).body.sessions;
  assert.equal(sessions.length, 1); assert.deepEqual(Object.keys(sessions[0]).sort(), ['agentId', 'id', 'title', 'updatedAt']); assert.ok(sessions[0].updatedAt > 1e12);
  a.runtime.store.appendMessages(sid, [{ role: 'user', content: [{ type: 'text', text: 'ข้อความค้นหา' }] }]);
  assert.equal((await call(a, '/api/sessions?q=' + encodeURIComponent('ค้นหา'))).body.sessions[0].id, sid);
  assert.equal((await call(a, '/api/sessions?limit=-1')).status, 400);
  assert.deepEqual((await call(a, `/api/sessions/${sid}/interrupt`, 'POST')).body, { ok: false });
  assert.equal((await call(a, `/api/sessions/${sid}`, 'DELETE')).status, 200);
  assert.equal((await call(a, `/api/sessions/${sid}`)).status, 404);
  assert.equal((await call(a, '/api/approvals/missing', 'POST', { allow: true })).status, 404);

  const settings = (await call(a, '/api/settings')).body;
  assert.equal(settings.config.version, 1); assert.deepEqual(settings.secrets, { LINE_CHANNEL_ACCESS_TOKEN: '', LINE_CHANNEL_SECRET: '' });
  settings.config.agent.maxTurns = 7; settings.config.hooks.preTool = [{ command: 'true', tools: ['read_file'], timeoutMs: 10 }];
  assert.equal((await call(a, '/api/settings', 'PUT', settings)).body.config.agent.maxTurns, 7);
  assert.equal(loadConfig(a.home).agent.maxTurns, 7);
  assert.equal((await call(a, '/api/settings', 'PUT', { config: {} })).status, 400);
  for (const mutate of [(c: any) => c.permissions.read_file = 'invalid', (c: any) => c.permissions.read_file = ['allow'], (c: any) => c.agent.maxTurns = 0, (c: any) => c.mcp.servers['bad__name'] = fakeMcp, (c: any) => c.hooks.preTool = [{ command: '' }]]) {
    const c = structuredClone(settings.config); mutate(c); assert.equal((await call(a, '/api/settings', 'PUT', { config: c })).status, 400);
  }
  assert.equal((await call(a, '/api/secrets', 'PUT', { name: 'VALUE', value: 'test-value' })).body.masked, '••••');
  assert.equal((await call(a, '/api/secrets', 'PUT', { name: 'bad name', value: 'fake' })).status, 400);
  assert.equal((await call(a, '/api/mcp', 'POST', { name: 'bad__name', config: fakeMcp })).status, 400);
  assert.equal((await call(a, '/api/mcp', 'POST', { name: 'fake', config: fakeMcp })).status, 200);
  const server = (await call(a, '/api/mcp')).body.servers.find((s: any) => s.name === 'fake');
  assert.equal(server.transport, 'stdio'); assert.equal(server.connected, true); assert.equal(server.tools.length, 5); assert.equal(server.tools[0].selected, true);
  const tools = (await call(a, '/api/mcp/fake/tools')).body.tools;
  assert.deepEqual(tools[0], { name: 'echo', description: 'Echo', selected: true });
  assert.deepEqual((await call(a, '/api/mcp/fake/test', 'POST')).body, { ok: true, tools: 5 });
  assert.equal((await call(a, '/api/mcp/fake', 'PATCH', { tools: ['echo'] })).status, 200);
  assert.equal((await call(a, '/api/mcp/fake/tools')).body.tools.find((s: any) => s.name === 'fail').selected, false);
  assert.equal((await call(a, '/api/mcp/fake', 'PATCH', { enabled: false })).status, 200);
  assert.deepEqual((await call(a, '/api/mcp/fake/test', 'POST')).body, { ok: true, tools: 5 });
  assert.equal((await call(a, '/api/mcp/fake', 'PATCH', { enabled: 'yes' })).status, 400);
  assert.deepEqual((await call(a, '/api/mcp/rea', 'DELETE')).body, { error: 'rea is built in: disable it instead' });
  assert.equal((await call(a, '/api/mcp/rea', 'DELETE')).status, 400);
  assert.equal((await call(a, '/api/mcp/fake', 'DELETE')).status, 200);
  assert.equal((await call(a, '/api/mcp/fake/test', 'POST')).status, 404);
  assert.equal((await call(a, '/api/mcp/constructor/test', 'POST')).status, 404);

  assert.deepEqual((await call(a, '/api/skills')).body.skills.filter((s: any) => !s.bundled), []);
  assert.equal((await call(a, '/api/skills/sample', 'PUT', { description: 'Sample skill', body: 'Do a small thing.' })).status, 200);
  assert.deepEqual((await call(a, '/api/skills')).body.skills.filter((s: any) => !s.bundled), [{ name: 'sample', description: 'Sample skill' }]);
  assert.deepEqual((await call(a, '/api/skills/sample')).body, { name: 'sample', description: 'Sample skill', body: 'Do a small thing.' });
  assert.equal((await call(a, '/api/skills/sample', 'DELETE')).status, 200);
  assert.equal((await call(a, '/api/skills/sample')).status, 404);
  assert.equal((await call(a, '/api/skills/..%2Fescape', 'PUT', { description: 'bad', body: 'bad' })).status, 400);
  const note = (await call(a, '/api/memory', 'POST', { kind: 'user', text: 'ชอบกาแฟ' })).body;
  assert.deepEqual(Object.keys(note).sort(), ['agentId', 'id', 'kind', 'text', 'updatedAt']); assert.ok(note.updatedAt > 1e12);
  assert.equal((await call(a, '/api/memory?kind=user&q=' + encodeURIComponent('กาแฟ'))).body.notes[0].id, note.id);
  assert.equal((await call(a, '/api/memory?kind=agent')).body.notes.length, 0);
  assert.equal((await call(a, `/api/memory/${note.id}`, 'PUT', { text: 'ชา' })).body.text, 'ชา');
  assert.equal((await call(a, `/api/memory/${note.id}`, 'DELETE')).status, 200);
  assert.equal((await call(a, `/api/memory/${note.id}`, 'PUT', { text: 'gone' })).status, 404);
  assert.equal((await call(a, '/api/memory?kind=wrong')).status, 400);
  assert.deepEqual((await call(a, '/api/schedules')).body, { jobs: [] });
  assert.equal((await call(a, '/api/schedules', 'POST', { cron: 'bad', prompt: 'task', delivery: { kind: 'desktop' } })).status, 400);
  const job = (await call(a, '/api/schedules', 'POST', { cron: '* * * * *', prompt: 'task', delivery: { kind: 'desktop' } })).body;
  assert.deepEqual(Object.keys(job).sort(), ['agentId', 'cron', 'delivery', 'enabled', 'id', 'prompt']);
  assert.ok((await call(a, '/api/schedules')).body.jobs[0].nextRunAt > 1e12);
  assert.equal((await call(a, `/api/schedules/${job.id}`, 'PATCH', { enabled: false })).status, 200);
  assert.equal((await call(a, '/api/schedules')).body.jobs[0].nextRunAt, null);
  assert.equal((await call(a, `/api/schedules/${job.id}`, 'DELETE')).status, 200);
  assert.equal((await call(a, '/api/memory', 'POST', { kind: 'user', text: 'x'.repeat(1024 * 1024) })).status, 413);
  const invalid = await fetch(url + '/api/sessions', { method: 'POST', headers: { Authorization: `Bearer ${a.token}` }, body: '{' });
  assert.equal(invalid.status, 400); assert.deepEqual(await invalid.json(), { error: 'invalid JSON' });
  assert.equal((await call(a, '/api/unknown')).status, 404);
});

test('SSE streams a tool round trip, approval decisions and active/pending state replay after reconnect', async t => {
  const home = testHome(t);
  const mock = await mockOpenai(t, (req, n) => {
    if (n === 1) return toolCall('write_file', { path: 'approved.txt', content: 'approved evidence' });
    assert.equal(req.messages.find((m: any) => m.role === 'tool').content, 'written');
    return { content: 'Done ไทย' };
  });
  configured(home, mock.baseUrl);
  const a = await app(t, { home }), stream = await events(a, t);
  const id = (await call(a, '/api/sessions', 'POST', {})).body.id;
  const started = await call(a, `/api/sessions/${id}/messages`, 'POST', { text: 'write this' });
  assert.equal(started.status, 202);
  const request = await stream.wait(e => e.type === 'approval_request');
  assert.equal(request.runId, started.body.runId); assert.equal(request.sessionId, id);
  assert.equal(stream.values.filter(e => e.type === 'approval_request').length, 1);
  assert.equal((await call(a, `/api/sessions/${id}/messages`, 'POST', { text: 'another' })).status, 409);
  assert.equal((await call(a, `/api/sessions/${id}`, 'DELETE')).status, 409);
  await stream.close();
  const reconnected = await events(a, t);
  await reconnected.wait(e => e.type === 'approval_request');
  assert.deepEqual(reconnected.values.slice(0, 2), [{ type: 'run_start', sessionId: id, runId: started.body.runId }, request]);
  assert.equal((await call(a, `/api/approvals/${request.approvalId}`, 'POST', { allow: true })).status, 200);
  assert.equal((await call(a, `/api/approvals/${request.approvalId}`, 'POST', { allow: true })).status, 404);
  assert.equal((await reconnected.wait(e => e.type === 'run_end')).status, 'done');
  assert.equal(readFileSync(join(home, 'approved.txt'), 'utf8'), 'approved evidence');
  assert.ok(reconnected.values.some(e => e.type === 'approval_result' && e.allowed));
  assert.ok(reconnected.values.some(e => e.type === 'text_delta' && e.text === 'Done ไทย'));
  const detail = (await call(a, `/api/sessions/${id}`)).body;
  assert.equal(detail.title, 'write this'); assert.equal(detail.messages.length, 4);
  assert.deepEqual(a.runtime.store.getSession(id)!.context, detail.messages);
  assert.deepEqual(a.runtime.replay(), []);
});

test('interrupt denies a pending approval, and 10 minute timeout denies without leaking active state', async t => {
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'denied.txt', content: 'no' } };
    else yield { type: 'text_delta', text: 'denied' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { providerFactory: () => provider });
  const stream = await events(a, t), id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const first = a.runtime.start(id, 'write');
  const approval = await stream.wait(e => e.type === 'approval_request');
  assert.deepEqual((await call(a, `/api/sessions/${id}/interrupt`, 'POST')).body, { ok: true });
  assert.equal((await first.result).status, 'interrupted');
  assert.equal((await call(a, `/api/approvals/${approval.approvalId}`, 'POST', { allow: true })).status, 404);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const next = a.runtime.start(id, 'try again');
  // A fresh session forces the scripted tool call again.
  await next.result;
  const secondId = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const second = a.runtime.start(secondId, 'write');
  while (!a.runtime.pendingEvents().length) await new Promise(resolve => setImmediate(resolve));
  const pending = a.runtime.pendingEvents()[0]! as any;
  t.mock.timers.tick(600_000);
  assert.equal((await second.result).status, 'done');
  assert.equal(a.runtime.pendingEvents().length, 0);
  assert.match(JSON.stringify(a.runtime.store.getMessages(secondId)), /denied by user/);
  assert.equal(a.runtime.decideApproval(pending.approvalId, true), false);
  t.mock.timers.reset();
});

test('nested delegate approvals surface through runtime rather than suppressed agent events', async t => {
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    const first = req.messages[0]!.content[0]!;
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'call', name: first.type === 'text' && first.text === 'nested' ? 'write_file' : 'delegate', input: first.type === 'text' && first.text === 'nested' ? { path: 'nested.txt', content: 'ok' } : { task: 'nested' } };
    else yield { type: 'text_delta', text: 'nested done' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { providerFactory: () => provider }), stream = await events(a, t);
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const run = a.runtime.start(id, 'delegate');
  const approval = await stream.wait(e => e.type === 'approval_request');
  assert.equal(approval.tool, 'write_file'); assert.equal(approval.runId, run.runId);
  assert.equal((await call(a, `/api/approvals/${approval.approvalId}`, 'POST', { allow: true })).status, 200);
  assert.equal((await run.result).status, 'done');
  assert.equal(readFileSync(join(a.home, 'nested.txt'), 'utf8'), 'ok');
});

test('settings mask literal MCP env/headers and retain their original values in whole-config round trips', async t => {
  const home = testHome(t), value = 'private-' + 'x'.repeat(16);
  configured(home, undefined, c => {
    c.providers[0]!.apiKeyEnv = 'PROVIDER_KEY';
    c.mcp.servers.stdio = { transport: 'stdio', command: 'unused', env: { VALUE: value, REF: '${PROVIDER_KEY}' }, enabled: false };
    c.mcp.servers.http = { transport: 'http', url: 'http://127.0.0.1:1', headers: { Authorization: value, 'X-Ref': '${PROVIDER_KEY}' }, enabled: false };
  });
  setSecret('PROVIDER_KEY', value, home);
  const a = await app(t, { home });
  const settings = (await call(a, '/api/settings')).body;
  assert.ok(!JSON.stringify(settings).includes(value));
  assert.equal(settings.secrets.PROVIDER_KEY, maskSecret(value));
  assert.deepEqual(settings.config.mcp.servers.stdio.env, { VALUE: maskSecret(value), REF: '${PROVIDER_KEY}' });
  assert.deepEqual(settings.config.mcp.servers.http.headers, { Authorization: maskSecret(value), 'X-Ref': '${PROVIDER_KEY}' });
  settings.config.agent.maxTurns = 10;
  assert.equal((await call(a, '/api/settings', 'PUT', settings)).status, 200);
  const saved = loadConfig(home);
  assert.equal((saved.mcp.servers.stdio as any).env.VALUE, value);
  assert.equal((saved.mcp.servers.http as any).headers.Authorization, value);
  settings.config.mcp.servers.stdio.env.VALUE = 'replacement';
  await call(a, '/api/settings', 'PUT', settings);
  assert.equal((loadConfig(home).mcp.servers.stdio as any).env.VALUE, 'replacement');
  assert.equal((await call(a, '/api/secrets', 'PUT', { name: 'PROVIDER_KEY', value: '' })).body.masked, '');
  assert.equal(readEnv(home).PROVIDER_KEY, undefined);
});

test('LINE requires both secrets, reloads live, and raises all allow tools to ask for non-owner group senders', async t => {
  const home = testHome(t);
  configured(home, undefined, c => { c.line.enabled = true; c.line.publicUrl = 'https://line.invalid/'; c.line.allow = { users: ['owner'], groups: ['group'], rooms: [] }; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home);
  const sent: any[] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (req.messages.at(-1)!.content[0]!.type === 'text') yield { type: 'tool_call', id: 'read', name: 'read_file', input: { path: 'evidence.txt' } };
    else yield { type: 'text_delta', text: 'answer' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider, lineOptions: { fetchImpl: async (_url, init) => { sent.push(JSON.parse(String(init?.body))); return new Response('{}'); } } });
  assert.equal(a.lineStatus().running, false);
  await call(a, '/api/secrets', 'PUT', { name: 'LINE_CHANNEL_SECRET', value: 'test-secret' });
  assert.equal(a.lineStatus().running, true); assert.ok(a.lineStatus().port > 0);
  writeFileSync(join(home, 'evidence.txt'), 'owner evidence');
  async function webhook(event: Record<string, unknown>) {
    const raw = JSON.stringify({ events: [{ webhookEventId: String(Math.random()), replyToken: 'test-reply', source: { type: 'group', groupId: 'group', userId: 'visitor' }, ...event }] });
    const signature = createHmac('sha256', 'test-secret').update(raw).digest('base64');
    const response = await fetch(`http://127.0.0.1:${a.lineStatus().port}/line/webhook`, { method: 'POST', headers: { 'X-Line-Signature': signature }, body: raw });
    assert.equal(response.status, 200);
  }
  await webhook({ type: 'message', message: { type: 'text', text: 'read evidence' } });
  const deadline = Date.now() + 3000;
  while (!sent.some(b => b.messages.some((m: any) => m.template?.type === 'confirm'))) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  const confirm = sent.flatMap(b => b.messages).find(m => m.template?.type === 'confirm');
  assert.match(confirm.template.text, /read_file/);
  // The prompt and title are saved when the run starts; the answer to the pending approval has not been given yet.
  const pending = a.runtime.store.findSessionByOrigin({ kind: 'line', to: 'group' }, a.runtime.store.listAgents()[0]!.id)!;
  assert.equal(pending.title, 'read evidence'); assert.equal(a.runtime.store.getMessages(pending.id).length, 2);
  await webhook({ type: 'postback', source: { type: 'group', groupId: 'group', userId: 'owner' }, postback: { data: confirm.template.actions[0].data } });
  while (a.runtime.replay().length) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  const session = a.runtime.store.findSessionByOrigin({ kind: 'line', to: 'group' }, a.runtime.store.listAgents()[0]!.id)!;
  assert.equal(session.title, 'read evidence'); assert.match(JSON.stringify(a.runtime.store.getMessages(session.id)), /owner evidence/);
  const status = (await call(a, '/api/line/status')).body;
  assert.ok(status.lastEventAt > 1e12); assert.equal('pending' in status, false); assert.equal(status.webhookUrl, 'https://line.invalid/line/webhook');
  // Direct owner messages reuse the session and need no new approval for read_file.
  const before = sent.length;
  assert.equal(await a.runtime.lineMessage({ to: 'group', userId: 'owner', text: 'read again' }), 'answer');
  assert.equal(sent.length, before); assert.equal(a.runtime.store.listSessions().length, 1);
  const settings = (await call(a, '/api/settings')).body; settings.config.line.enabled = false;
  await call(a, '/api/settings', 'PUT', settings);
  assert.equal(a.lineStatus().running, false);
});

test('cron delivers desktop notification/session and redacts persisted scheduler failures', async t => {
  const home = testHome(t); configured(home);
  const sensitive = 'private-' + 'z'.repeat(16); setSecret('VALUE', sensitive, home);
  let fail = false;
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (fail) throw new Error(sensitive);
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'cron.txt', content: 'task evidence' } };
    else yield { type: 'text_delta', text: 'task done' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  let clock = new Date(2026, 0, 1, 0, 0), tick: (() => void) | undefined;
  const a = await app(t, { home, providerFactory: () => provider, schedulerOptions: { now: () => clock, setTimer: fn => { tick = fn; return () => {}; } } }), stream = await events(a, t);
  const job = a.scheduler.add({ agentId: a.runtime.store.listAgents()[0]!.id, cron: '* * * * *', prompt: 'task', delivery: { kind: 'desktop' } });
  const fire = a.runtime.fireJob(job);
  const ask = await stream.wait(e => e.type === 'approval_request');
  assert.equal((await call(a, `/api/approvals/${ask.approvalId}`, 'POST', { allow: true })).status, 200);
  await fire;
  const notification = await stream.wait(e => e.type === 'notification');
  assert.equal(notification.body, 'task done'); assert.ok(a.runtime.store.getMessages(notification.sessionId).length);
  fail = true;
  await assert.rejects(a.runtime.fireJob(job), e => e instanceof Error && !e.message.includes(sensitive));
  assert.ok(!JSON.stringify(a.runtime.store.getMessages(a.runtime.store.listSessions()[0]!.id)).includes(sensitive));
  clock = new Date(2026, 0, 1, 0, 1); tick!();
  while (a.scheduler.list()[0]!.lastStatus === 'running') await new Promise(resolve => setImmediate(resolve));
  const scheduled = (await call(a, '/api/schedules')).body.jobs[0];
  assert.ok(scheduled.lastRunAt > 1e12); assert.match(scheduled.lastStatus, /error:.*••••/); assert.ok(!scheduled.lastStatus.includes(sensitive));
  assert.ok(!readFileSync(join(home, 'bignose.db')).includes(Buffer.from(sensitive)));
});

test('cron LINE delivery is ready before a slow MCP connector and uses confirm buttons then pushes the answer', async t => {
  const home = testHome(t);
  configured(home, undefined, c => { c.line.enabled = true; c.line.allow.users = ['owner']; c.mcp.servers.slow = { ...fakeMcp, args: [...fakeMcp.args, '--delay-init'] }; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  setSecret('VALUE', 'test-value', home);
  const sent: any[] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'scheduled.txt', content: 'approved cron' } };
    else yield { type: 'text_delta', text: 'scheduled answer' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider, lineOptions: { fetchImpl: async (url, init) => { sent.push({ url: String(url), ...JSON.parse(String(init?.body)) }); return new Response('{}'); } } });
  const deadline = Date.now() + 3000;
  while (!a.lineStatus().running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(a.mcp.status().find(s => s.name === 'slow')!.connected, false);
  const job = a.scheduler.add({ agentId: a.runtime.store.listAgents()[0]!.id, cron: '* * * * *', prompt: 'scheduled task', delivery: { kind: 'line', to: 'owner' } });
  const fire = a.runtime.fireJob(job);
  while (!sent.length) await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent[0].to, 'owner'); assert.match(sent[0].url, /message\/push$/);
  assert.equal(a.runtime.pendingEvents().length, 0);
  const confirm = sent[0].messages[0].template;
  assert.equal(confirm.type, 'confirm'); assert.match(confirm.text, /write_file/);
  const raw = JSON.stringify({ events: [{ type: 'postback', webhookEventId: 'cron-approval', source: { type: 'user', userId: 'owner' }, postback: { data: confirm.actions[0].data } }] });
  const signature = createHmac('sha256', 'test-secret').update(raw).digest('base64');
  assert.equal((await fetch(`http://127.0.0.1:${a.lineStatus().port}/line/webhook`, { method: 'POST', headers: { 'X-Line-Signature': signature }, body: raw })).status, 200);
  await fire;
  assert.deepEqual(sent[1].messages, [{ type: 'text', text: 'scheduled answer' }]); assert.equal(sent[1].to, 'owner'); assert.match(sent[1].url, /message\/push$/);
  assert.equal(readFileSync(join(home, 'scheduled.txt'), 'utf8'), 'approved cron');
});

test('MCP reference secrets reload live and shutdown denies outstanding approvals', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.mcp.servers.fake = fakeMcp; });
  setSecret('VALUE', 'first-value', home);
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'shutdown.txt', content: 'no' } };
    yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider });
  const ctx = { sessionId: 'test', origin: { kind: 'desktop' as const }, cwd: home, signal: new AbortController().signal, depth: 0 };
  const echo = () => a.mcp.tools().find(t => t.name === 'mcp__fake__echo')!;
  // Longer secrets retain their final four characters after masking, exposing which connection env was used.
  await call(a, '/api/secrets', 'PUT', { name: 'VALUE', value: 'long-first-value' });
  assert.equal((await echo().run({ text: 'ok' }, ctx)).content, 'ok\n••••alue|path');
  await call(a, '/api/secrets', 'PUT', { name: 'VALUE', value: 'long-next-env' });
  assert.equal((await echo().run({ text: 'ok' }, ctx)).content, 'ok\n••••-env|path');
  const session = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } });
  const run = a.runtime.start(session.id, 'pending approval');
  while (!a.runtime.pendingEvents().length) await new Promise(resolve => setImmediate(resolve));
  await a.close();
  assert.equal((await run.result).status, 'interrupted'); assert.equal(a.runtime.pendingEvents().length, 0);
  assert.equal(a.mcp.tools().length, 0);
});

test('one per-run profile freezes provider/model/system/permissions/tool filter while settings change', async t => {
  const requests: any[] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    requests.push(req);
    yield { type: 'text_delta', text: req.model };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { providerFactory: () => provider });
  a.runtime.store.addMemory('user', 'memory fact');
  const profile = a.runtime.profile(); profile.model = 'profile-model'; profile.system = 'agent instructions'; profile.memory = ''; profile.toolFilter = tool => tool.name === 'read_file';
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const run = a.runtime.start(id, 'hello', { profile });
  profile.model = 'mutated-profile'; profile.system = 'changed instructions';
  const settings = (await call(a, '/api/settings')).body; settings.config.active.model = 'changed-model'; await call(a, '/api/settings', 'PUT', settings);
  assert.equal((await run.result).text, 'profile-model');
  assert.equal(requests[0].model, 'profile-model'); assert.equal(requests[0].system, 'agent instructions'); assert.deepEqual(requests[0].tools.map((t: any) => t.name), ['read_file']);
  const fresh = a.runtime.profile(); assert.equal(fresh.model, 'changed-model'); assert.match(fresh.memory!, /memory fact/); assert.match(fresh.system, /Today: \d{4}-\d{2}-\d{2}/);
});

test('chunked oversized requests return 413 without losing the response socket', async t => {
  const a = await app(t);
  const status = await new Promise<number>((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: a.port, path: '/api/memory', method: 'POST', headers: { Authorization: `Bearer ${a.token}`, 'Transfer-Encoding': 'chunked' } }, res => { res.resume(); resolve(res.statusCode!); });
    req.on('error', reject); req.write('x'.repeat(600_000)); req.end('x'.repeat(600_000));
  });
  assert.equal(status, 413);
});

test('short environment values preserve config, API text, transcript and context while long values remain masked', async t => {
  const home = testHome(t), ordinary = 'found 12 matches in 1 file by boombignose';
  const sensitive = 'private-' + 'x'.repeat(16);
  configured(home, undefined, c => { c.agent.workspace = join(home, 'boom1'); c.agent.systemPrompt = ordinary; });
  setSecret('LEVEL', '1', home); setSecret('GITHUB_USER', 'boom', home); setSecret('VALUE', sensitive, home);
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    yield { type: 'text_delta', text: ordinary + ': ' + sensitive };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider });
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const result = await a.runtime.start(id, ordinary).result;
  assert.equal(result.text, ordinary + ': ' + maskSecret(sensitive));
  const transcript = a.runtime.store.getMessages(id);
  assert.deepEqual(transcript[0]!.content, [{ type: 'text', text: ordinary }]);
  assert.deepEqual(a.runtime.store.getSession(id)!.context, transcript);
  const detail = (await call(a, `/api/sessions/${id}`)).body;
  assert.deepEqual(detail.messages, transcript); assert.equal(detail.title, ordinary);
  const settings = (await call(a, '/api/settings')).body;
  assert.equal(settings.config.agent.workspace, join(home, 'boom1')); assert.equal(settings.config.agent.systemPrompt, ordinary);
  assert.equal(settings.secrets.LEVEL, '••••'); assert.equal(settings.secrets.VALUE, maskSecret(sensitive));
  assert.equal((await call(a, '/api/settings', 'PUT', settings)).status, 200);
  assert.equal(loadConfig(home).agent.workspace, join(home, 'boom1')); assert.equal(loadConfig(home).agent.systemPrompt, ordinary);
});

test('one cleaner snapshots secrets for all strings in a response or persistence batch', t => {
  const home = testHome(t), config = configured(home), sensitive = 'first-' + 'x'.repeat(16);
  setSecret('VALUE', sensitive, home);
  const clean = createCleaner(home, config);
  setSecret('VALUE', 'replacement', home);
  assert.deepEqual(safeValue({ first: sensitive, blocks: [sensitive, sensitive] }, clean), { first: maskSecret(sensitive), blocks: [maskSecret(sensitive), maskSecret(sensitive)] });
  assert.equal(createCleaner(home, config)(sensitive), sensitive);
});

test('concurrent MCP mutations compose against current config inside the startup queue', async t => {
  const home = testHome(t);
  configured(home, undefined, c => { c.mcp.servers.slow = { ...fakeMcp, args: [...fakeMcp.args, '--delay-init'] }; });
  setSecret('VALUE', 'test-value', home);
  const a = await app(t, { home }), config = { ...fakeMcp, enabled: false };
  assert.equal((await call(a, '/api/mcp')).body.servers.find((s: any) => s.name === 'slow').connected, false);
  const added = await Promise.all(['one', 'two'].map(name => call(a, '/api/mcp', 'POST', { name, config })));
  assert.deepEqual(added.map(r => r.status), [200, 200]);
  assert.ok(loadConfig(home).mcp.servers.one); assert.ok(loadConfig(home).mcp.servers.two);
  const duplicate = await Promise.all([0, 1].map(() => call(a, '/api/mcp', 'POST', { name: 'same', config })));
  assert.deepEqual(duplicate.map(r => r.status).sort(), [200, 400]);
  const patched = await Promise.all([
    call(a, '/api/mcp/one', 'PATCH', { enabled: true }),
    call(a, '/api/mcp/one', 'PATCH', { tools: ['echo'] }),
  ]);
  assert.deepEqual(patched.map(r => r.status), [200, 200]);
  assert.equal(loadConfig(home).mcp.servers.one!.enabled, true); assert.deepEqual(loadConfig(home).mcp.servers.one!.tools, ['echo']);
  const deleted = await Promise.all(['one', 'two'].map(name => call(a, `/api/mcp/${name}`, 'DELETE')));
  assert.deepEqual(deleted.map(r => r.status), [200, 200]);
  assert.equal(loadConfig(home).mcp.servers.one, undefined); assert.equal(loadConfig(home).mcp.servers.two, undefined);
});

test('SSE masks secrets split across deltas and flushes text before tool activity and interruption', async t => {
  const home = testHome(t), sensitive = 'private-' + 'x'.repeat(16), prefix = 'ordinary '.repeat(20);
  configured(home); setSecret('VALUE', sensitive, home);
  let interrupted = false;
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    yield { type: 'text_delta', text: prefix + sensitive.slice(0, 10) };
    yield { type: 'text_delta', text: sensitive.slice(10) + ' tail' };
    if (interrupted) { await new Promise<void>(resolve => req.signal!.addEventListener('abort', () => resolve(), { once: true })); return; }
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'memory', name: 'memory_read', input: {} };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider }), stream = await events(a, t);
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const done = a.runtime.start(id, 'echo'); await done.result;
  await stream.wait(e => e.type === 'run_end' && e.runId === done.runId);
  await stream.wait(e => e.type === 'session_updated' && e.sessionId === id);
  const output = stream.values.filter(e => e.runId === done.runId && e.type === 'text_delta').map(e => e.text).join('');
  assert.equal(output, (prefix + maskSecret(sensitive) + ' tail').repeat(2)); assert.ok(!output.includes(sensitive));
  const toolAt = stream.values.findIndex(e => e.type === 'tool_start');
  assert.equal(stream.values.slice(0, toolAt).filter(e => e.type === 'text_delta').map(e => e.text).join(''), prefix + maskSecret(sensitive) + ' tail');
  const endAt = stream.values.findIndex(e => e.type === 'run_end');
  assert.equal(stream.values[endAt + 1].type, 'session_updated');
  interrupted = true;
  const stopped = a.runtime.start(id, 'interrupt');
  await stream.wait(e => e.type === 'text_delta' && e.runId === stopped.runId);
  a.runtime.interrupt(id); assert.equal((await stopped.result).status, 'interrupted');
  await stream.wait(e => e.type === 'run_end' && e.runId === stopped.runId);
  assert.equal(stream.values.filter(e => e.runId === stopped.runId && e.type === 'text_delta').map(e => e.text).join(''), prefix + maskSecret(sensitive) + ' tail');
});

test('non-owner LINE context keeps visible chat text and drops owner tool turns and summaries', async t => {
  const home = testHome(t), marker = 'owner-file-marker';
  configured(home, undefined, c => { c.line.allow = { users: ['owner'], groups: ['group'], rooms: ['room'] }; c.permissions.write_file = 'allow'; });
  writeFileSync(join(home, 'owner.txt'), marker);
  let visitor = false, calls = 0;
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (visitor) {
      assert.ok(!JSON.stringify(req.messages).includes(marker), 'private owner data reached the visitor provider request');
      assert.deepEqual(req.messages, [
        { role: 'user', content: [{ type: 'text', text: 'read file' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'File checked.' }] },
        { role: 'user', content: [{ type: 'text', text: 'what else was in the file?' }] },
      ]);
      yield { type: 'text_delta', text: 'Owner approval is required to read that file again.' };
    } else if (++calls === 1) {
      yield { type: 'text_delta', text: `Private notes say ${marker}; now checking the file.` };
      yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'owner.txt', content: marker } };
    } else if (calls === 2) {
      assert.ok(req.messages.some(m => m.content.some(b => b.type === 'tool_use' && b.input.content === marker)));
      assert.ok(req.messages.some(m => m.content.some(b => b.type === 'text' && b.text.includes(marker))));
      yield { type: 'tool_call', id: 'read', name: 'read_file', input: { path: 'owner.txt' } };
    } else yield { type: 'text_delta', text: 'File checked.' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider });
  assert.equal(await a.runtime.lineMessage({ to: 'group', userId: 'owner', text: 'read file' }), 'File checked.');
  const session = a.runtime.store.findSessionByOrigin({ kind: 'line', to: 'group' }, a.runtime.store.listAgents()[0]!.id)!;
  assert.ok(JSON.stringify(a.runtime.store.getSession(session.id)!.context).includes(marker));
  const prior = a.runtime.store.getSession(session.id)!.context;
  a.runtime.store.setContext(session.id, [{ role: 'user', content: [{ type: 'text', text: `[Summary of earlier conversation]\n${marker}` }] }, ...prior]);
  visitor = true;
  assert.equal(await a.runtime.lineMessage({ to: 'group', userId: 'visitor', text: 'what else was in the file?' }), 'Owner approval is required to read that file again.');
  assert.ok(JSON.stringify(a.runtime.store.getSession(session.id)!.context).includes(marker), 'the stored owner context is preserved');
  assert.ok(JSON.stringify(a.runtime.store.getMessages(session.id)).includes(marker));
  assert.equal(a.runtime.store.listSessions().length, 1);
});

test('literal MCP paths and URLs are masked in their own fields while ordinary config text remains intact', async t => {
  const home = testHome(t), baseUrl = 'https://mock.invalid/v1';
  const original = configured(home, baseUrl, c => {
    c.agent.systemPrompt = `Work under ${home}`;
    c.hooks.preTool = [{ command: `cd ${home}` }];
    c.line.publicUrl = baseUrl;
    c.mcp.servers.local = { ...fakeMcp, args: [home], env: { ROOT: home, URL: baseUrl }, enabled: false };
  });
  const a = await app(t, { home }), settings = (await call(a, '/api/settings')).body;
  assert.equal(settings.config.agent.workspace, home);
  assert.equal(settings.config.agent.systemPrompt, `Work under ${home}`);
  assert.equal(settings.config.hooks.preTool[0].command, `cd ${home}`);
  assert.equal(settings.config.providers[0].baseUrl, baseUrl);
  assert.equal(settings.config.line.publicUrl, baseUrl);
  assert.deepEqual(settings.config.mcp.servers.local.args, [home]);
  assert.deepEqual(settings.config.mcp.servers.local.env, { ROOT: maskSecret(home), URL: maskSecret(baseUrl) });
  assert.equal((await call(a, '/api/settings', 'PUT', settings)).status, 200);
  assert.deepEqual(loadConfig(home), original);
  const changed = structuredClone(settings);
  changed.config.agent.workspace = join(home, 'new-workspace');
  changed.config.agent.systemPrompt = 'New prompt'; changed.config.hooks.preTool[0].command = 'true';
  assert.equal((await call(a, '/api/settings', 'PUT', changed)).status, 200);
  const saved = loadConfig(home);
  assert.equal(saved.agent.workspace, changed.config.agent.workspace);
  assert.equal(saved.agent.systemPrompt, 'New prompt'); assert.equal(saved.hooks.preTool![0]!.command, 'true');
  assert.equal(saved.providers[0]!.baseUrl, baseUrl); assert.equal(saved.line.publicUrl, baseUrl);
  assert.deepEqual(saved.mcp.servers.local, original.mcp.servers.local);
  changed.config.providers[0].baseUrl = 'invalid-url';
  assert.equal((await call(a, '/api/settings', 'PUT', changed)).status, 400);
  assert.deepEqual(loadConfig(home), saved);
});

test('settings restore deleted/reordered array elements and reject edited masks without saving', async t => {
  const home = testHome(t);
  setSecret('WORK_ROOT', home, home);
  const original = configured(home, undefined, c => {
    c.hooks.preTool = [{ command: 'echo first' }, { command: `cd ${home} && ./check.sh` }];
    c.mcp.servers.local = { ...fakeMcp, args: ['first', home], env: { ROOT: home }, enabled: false };
  });
  const a = await app(t, { home }), settings = (await call(a, '/api/settings')).body;
  const deleted = structuredClone(settings);
  deleted.config.hooks.preTool.shift(); deleted.config.mcp.servers.local.args.shift();
  assert.equal((await call(a, '/api/settings', 'PUT', deleted)).status, 200);
  assert.deepEqual(loadConfig(home).hooks.preTool, [original.hooks.preTool![1]]);
  assert.deepEqual(loadConfig(home).mcp.servers.local, { ...original.mcp.servers.local, args: [home] });
  assert.equal((await call(a, '/api/settings', 'PUT', { config: original })).status, 200);
  const reversed = structuredClone(settings);
  reversed.config.hooks.preTool.reverse(); reversed.config.mcp.servers.local.args.reverse();
  assert.equal((await call(a, '/api/settings', 'PUT', reversed)).status, 200);
  assert.deepEqual(loadConfig(home).hooks.preTool, [...original.hooks.preTool!].reverse());
  assert.deepEqual(loadConfig(home).mcp.servers.local, { ...original.mcp.servers.local, args: [home, 'first'] });
  const before = readFileSync(join(home, 'config.json'), 'utf8'), edited = structuredClone(settings);
  edited.config.hooks.preTool[1].command += ' --edited';
  const rejected = await call(a, '/api/settings', 'PUT', edited);
  assert.equal(rejected.status, 400);
  assert.deepEqual(rejected.body, { error: 'a masked value could not be restored; re-enter it' });
  assert.equal(readFileSync(join(home, 'config.json'), 'utf8'), before);
});

test('scheduled session titles redact known values before the 60-character cut', async t => {
  const home = testHome(t), sensitive = 'private-' + 'z'.repeat(16), prompt = 'a'.repeat(40) + sensitive + ' tail';
  configured(home); setSecret('VALUE', sensitive, home);
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider });
  await a.runtime.fireJob({ agentId: a.runtime.store.listAgents()[0]!.id, id: 'title', cron: '* * * * *', prompt, delivery: { kind: 'desktop' }, enabled: true });
  const title = a.runtime.store.listSessions()[0]!.title;
  assert.equal(title, `Scheduled: ${('a'.repeat(40) + maskSecret(sensitive) + ' tail').slice(0, 60)}`);
  assert.ok(!title.includes('z'.repeat(8)));
  assert.equal((await call(a, '/api/sessions')).body.sessions[0].title, title);
});

test('session titles and truncated tool previews never leak a secret crossing the cut', async t => {
  const home = testHome(t), sensitive = 'private-' + 'x'.repeat(16), input = 'a'.repeat(60) + sensitive + ' suffix';
  configured(home); setSecret('VALUE', sensitive, home);
  writeFileSync(join(home, 'long.txt'), 'A'.repeat(1980) + sensitive + ' tail');
  writeFileSync(join(home, 'short.txt'), sensitive);
  let calls = 0;
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    if (++calls === 1) {
      yield { type: 'tool_call', id: 'long', name: 'read_file', input: { path: 'long.txt' } };
      yield { type: 'tool_call', id: 'short', name: 'read_file', input: { path: 'short.txt' } };
    } else yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider }), stream = await events(a, t);
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  assert.equal((await a.runtime.start(id, input).result).status, 'done');
  const title = a.runtime.store.getSession(id)!.title;
  assert.equal(title, ('a'.repeat(60) + maskSecret(sensitive) + ' suffix').slice(0, 80));
  assert.ok(!title.includes('x'.repeat(8)));
  assert.equal((await call(a, '/api/sessions')).body.sessions[0].title, title);
  const preview = (await stream.wait(e => e.type === 'tool_end' && e.callId === 'long')).output;
  assert.ok(preview.length > 0 && preview.length <= 2000); assert.match(preview, /^A+$/);
  assert.equal((await stream.wait(e => e.type === 'tool_end' && e.callId === 'short')).output, maskSecret(sensitive));
  assert.ok(!JSON.stringify(a.runtime.store.getMessages(id)).includes(sensitive));
});

test('rotated secrets remain masked in tool events, stored/replayed approvals and transcript', async t => {
  const home = testHome(t), sensitive = 'old-' + 'x'.repeat(16);
  configured(home); setSecret('VALUE', sensitive, home);
  let calls = 0;
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    if (++calls === 1) {
      setSecret('VALUE', 'replacement', home);
      yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'rotated.txt', content: sensitive } };
    } else if (calls === 2) yield { type: 'tool_call', id: 'read', name: 'read_file', input: { path: 'rotated.txt' } };
    else yield { type: 'text_delta', text: 'done' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { home, providerFactory: () => provider }), stream = await events(a, t);
  const id = a.runtime.store.createSession({ agentId: a.runtime.store.listAgents()[0]!.id, origin: { kind: 'desktop' } }).id;
  const run = a.runtime.start(id, 'rotate and write');
  const approval = await stream.wait(e => e.type === 'approval_request');
  assert.equal(stream.values.find(e => e.type === 'tool_start').input.content, maskSecret(sensitive));
  assert.equal(approval.input.content, maskSecret(sensitive));
  assert.equal((a.runtime.pendingEvents()[0] as any).input.content, maskSecret(sensitive));
  const reconnected = await events(a, t);
  assert.equal((await reconnected.wait(e => e.type === 'approval_request')).input.content, maskSecret(sensitive));
  assert.equal((await call(a, `/api/approvals/${approval.approvalId}`, 'POST', { allow: true })).status, 200);
  assert.equal((await run.result).status, 'done');
  const readEnd = await stream.wait(e => e.type === 'tool_end' && e.name === 'read_file');
  assert.ok(readEnd.output.includes(maskSecret(sensitive))); assert.ok(!readEnd.output.includes(sensitive));
  assert.ok(!JSON.stringify(stream.values).includes(sensitive));
  assert.ok(!JSON.stringify(a.runtime.store.getMessages(id)).includes(sensitive));
});

test('a failed LINE bind retries after the port is freed and identical secrets are saved', async t => {
  const blocker = createServer((_req, res) => res.end());
  await new Promise<void>(resolve => blocker.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { blocker.close(() => resolve()); blocker.closeAllConnections(); }));
  const port = (blocker.address() as { port: number }).port, home = testHome(t);
  configured(home, undefined, c => { c.line.enabled = true; c.line.port = port; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  const a = await app(t, { home });
  const deadline = Date.now() + 3000;
  while (!a.lineStatus().lastError) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal(a.lineStatus().running, false); assert.match(a.lineStatus().lastError!, /EADDRINUSE/);
  await new Promise<void>(resolve => blocker.close(() => resolve()));
  assert.equal((await call(a, '/api/secrets', 'PUT', { name: 'LINE_CHANNEL_SECRET', value: 'test-secret' })).status, 200);
  assert.equal(a.lineStatus().running, true); assert.equal(a.lineStatus().port, port); assert.equal(a.lineStatus().lastError, undefined);
});

test('GET session during a run returns the user message and the live partial answer', async t => {
  const streaming = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) { yield { type: 'tool_call', id: 'c1', name: 'memory_read', input: {} }; yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } }; return; }
    yield { type: 'text_delta', text: 'half an ' }; yield { type: 'text_delta', text: 'answer ' + 'y'.repeat(150) };
    streaming.resolve(); await release.promise;
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await app(t, { providerFactory: () => provider }), stream = await events(a, t);
  const id = (await call(a, '/api/sessions', 'POST', {})).body.id;
  const started = await call(a, `/api/sessions/${id}/messages`, 'POST', { text: 'MY QUESTION' });
  try {
    await streaming.promise;
    const mid = (await call(a, `/api/sessions/${id}`)).body;
    assert.equal(mid.title, 'MY QUESTION');
    assert.deepEqual(mid.messages.map((m: any) => `${m.role}:${m.content.map((b: any) => b.type).join('+')}`), ['user:text', 'assistant:tool_use', 'user:tool_result']);
    // Like the event stream, the snapshot keeps back the last (longest secret - 1) characters: the API token is the secret here.
    const whole = 'half an answer ' + 'y'.repeat(150);
    assert.deepEqual(stream.values.filter(e => e.seq !== undefined).map(e => e.seq), [1, 2, 3]); // tool_start, tool_end, one released text_delta
    assert.deepEqual(mid.live, { runId: started.body.runId, seq: 3, text: whole.slice(0, whole.length - (a.token.length - 1)), tools: [] });
    assert.deepEqual(mid.notices, []);
  } finally { release.resolve(); }
  await stream.wait(e => e.type === 'run_end');
  const end = (await call(a, `/api/sessions/${id}`)).body;
  assert.equal(end.live, null);
  assert.equal(end.messages.length, 4); assert.equal(end.messages.at(-1).content[0].text, 'half an answer ' + 'y'.repeat(150));
  assert.deepEqual(end.notices, []);
});

test('run errors are stored as notices and survive a restart', async t => {
  const home = testHome(t);
  configured(home);
  const provider: Provider = { kind: 'openai-compatible', async *stream() { throw new Error('Provider HTTP 401: bad key'); } };
  const settled = async (a: App, id: string) => { for (let i = 0; i < 200 && a.runtime.isRunning(id); i++) await new Promise(r => setTimeout(r, 10)); };
  const first = await startDaemon({ home, providerFactory: () => provider });
  t.after(() => first.close()); // close() is idempotent: this only matters when an assertion fails first
  const id = (await call(first, '/api/sessions', 'POST', {})).body.id;
  await call(first, `/api/sessions/${id}/messages`, 'POST', { text: 'hello?' });
  await settled(first, id);
  const before = (await call(first, `/api/sessions/${id}`)).body;
  assert.deepEqual(before.notices.map((n: any) => [n.after, n.level, n.text]), [[1, 'error', 'Error: Provider HTTP 401: bad key']]);
  await first.close();
  const again = await app(t, { home, providerFactory: () => provider });
  const after = (await call(again, `/api/sessions/${id}`)).body;
  assert.deepEqual(after.notices, before.notices);
  assert.equal(after.messages.length, 1); assert.equal(after.title, 'hello?');
  // The next turn adds its own note after the old one, and the old one keeps its place.
  await call(again, `/api/sessions/${id}/messages`, 'POST', { text: 'second' });
  await settled(again, id);
  const two = (await call(again, `/api/sessions/${id}`)).body;
  assert.deepEqual(two.notices.map((n: any) => [n.after, n.level]), [[1, 'error'], [2, 'error']]);
});

test('a LINE-delivery schedule is refused while LINE is off, accepted while the gateway runs, and a desktop one is never refused', async t => {
  const job = { cron: '* * * * *', prompt: 'task', delivery: { kind: 'line', to: 'Cabc' } };
  const off = await app(t);
  const refused = await call(off, '/api/schedules', 'POST', job);
  assert.equal(refused.status, 400); assert.match(refused.body.error, /LINE is off/);
  assert.deepEqual((await call(off, '/api/schedules')).body, { jobs: [] }, 'nothing was saved');
  assert.equal((await call(off, '/api/schedules', 'POST', { ...job, delivery: { kind: 'desktop' } })).status, 200);

  const home = testHome(t);
  configured(home, undefined, c => { c.line.enabled = true; c.line.allow.users = ['owner']; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  const on = await app(t, { home });
  const deadline = Date.now() + 3000;
  while (!on.lineStatus().running) { assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.equal((await call(on, '/api/schedules', 'POST', job)).status, 200);
});

test('creating a skill with an existing name is refused with 409 and leaves the skill alone; a plain PUT still edits it', async t => {
  const a = await app(t);
  const put = (body: Record<string, unknown>) => call(a, '/api/skills/taxes', 'PUT', body);
  assert.equal((await put({ description: 'File taxes', body: 'Original steps.', create: true })).status, 200);
  const again = await put({ description: 'Scratch', body: 'Scratch.', create: true });
  assert.equal(again.status, 409); assert.match(again.body.error, /already exists/);
  assert.deepEqual((await call(a, '/api/skills/taxes')).body, { name: 'taxes', description: 'File taxes', body: 'Original steps.' });
  assert.equal((await put({ description: 'File taxes', body: 'Edited steps.' })).status, 200);
  assert.equal((await call(a, '/api/skills/taxes')).body.body, 'Edited steps.');
  assert.equal((await call(a, '/api/skills/..%2Fescape', 'PUT', { description: 'bad', body: 'bad', create: true })).status, 400);
});

test('saving a skill keeps its other frontmatter keys when the Skills page saves it unchanged', async t => {
  const home = testHome(t);
  configured(home);
  const folder = join(paths(home).skills, 'imported'); mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, 'SKILL.md'), '---\nname: imported\ndescription: An imported skill\nlicense: Apache-2.0\nallowed-tools: Bash(git:*) Read\nmetadata:\n  author: someone\n---\n\nSteps.\n');
  const a = await app(t, { home });
  const skill = (await call(a, '/api/skills/imported')).body;
  assert.equal((await call(a, '/api/skills/imported', 'PUT', { description: skill.description, body: skill.body })).status, 200);
  const text = readFileSync(join(folder, 'SKILL.md'), 'utf8');
  for (const line of ['license: Apache-2.0', 'allowed-tools: Bash(git:*) Read', 'metadata:\n  author: someone']) assert.ok(text.includes(line), line);
});
