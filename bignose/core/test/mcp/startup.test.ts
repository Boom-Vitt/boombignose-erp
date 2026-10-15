import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManager } from '../../src/mcp/manager.ts';
import type { McpServerConfig, Tool } from '../../src/types.ts';

const LIMIT_MS = 30_000; // bounds only stop a hang; a loaded machine is slow
async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP operation did not finish within ${LIMIT_MS} ms`)), LIMIT_MS);
    })]);
  } finally { clearTimeout(timer); }
}
const ctx = { sessionId: 'test', origin: { kind: 'cli' as const }, cwd: '/', signal: new AbortController().signal, depth: 0 };
const run = (tools: Tool[], name: string) => tools.find(tool => tool.name === name)!.run({ text: 'hi' }, ctx);
async function until(ok: () => boolean) {
  for (const stop = Date.now() + LIMIT_MS; !ok(); await new Promise(resolve => setTimeout(resolve, 10))) if (Date.now() > stop) assert.fail('timed out waiting');
}
const starts = (file: string) => existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;

function stdioFixture(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'bignose-mcp-start-')), gate = join(dir, 'gate');
  // One cleanup hook (hooks run in the order they were added): let a gated server finish, stop the manager, then remove the files.
  const cleanup = (manager: McpManager) => t.after(async () => { writeFileSync(gate, ''); await manager.stop(); rmSync(dir, { recursive: true, force: true }); });
  const server = (name: string, args: string[] = [], env: Record<string, string> = {}): { config: McpServerConfig; log: string } => {
    const log = join(dir, `${name}.log`);
    return { log, config: { transport: 'stdio', command: process.execPath, enabled: true, env,
      args: [fileURLToPath(new URL('fake-server.ts', import.meta.url)), '--lifecycle', log, ...args] } };
  };
  return { server, gate, cleanup };
}

test('connectors start in parallel: a slow one does not hold up the one after it', async t => {
  const { server, gate, cleanup } = stdioFixture(t);
  const slow = server('slow', ['--gate', gate]), quick = server('quick');
  const manager = new McpManager({ slow: slow.config, quick: quick.config }, {});
  cleanup(manager);
  const starting = manager.start();
  await bounded(manager.waitFor(['quick'], AbortSignal.timeout(LIMIT_MS))); // `quick` is listed after `slow`
  const [a, b] = manager.status();
  assert.deepEqual([a!.connected, a!.starting, b!.connected, b!.starting], [false, true, true, false]);
  assert.deepEqual(manager.tools().map(tool => tool.name).filter(name => name.startsWith('mcp__slow__')), []);
  writeFileSync(gate, '');
  await bounded(starting);
  assert.deepEqual(manager.status().map(s => [s.connected, s.starting]), [[true, false], [true, false]]);
});

test('a connector still starting is waited for only a bounded time', async t => {
  const { server, gate, cleanup } = stdioFixture(t);
  const manager = new McpManager({ slow: server('slow', ['--gate', gate]).config, off: { ...server('off').config, enabled: false } }, {});
  cleanup(manager);
  assert.equal(manager.status()[0]!.starting, false, 'nothing is starting before it is launched: settle() would not wait either');
  void manager.start();
  const began = Date.now();
  await bounded(manager.settle(['slow', 'off', 'missing'], 100, new AbortController().signal));
  assert.ok(Date.now() - began >= 90, 'it waited for the connector');
  assert.equal(manager.status()[0]!.starting, true, 'and gave up while it was still starting');
  const aborted = new AbortController(); setTimeout(() => aborted.abort(), 20);
  await bounded(manager.settle(['slow'], 60_000, aborted.signal)); // an interrupted chat stops waiting
  writeFileSync(gate, '');
  await bounded(manager.settle(['slow'], 60_000, new AbortController().signal));
  assert.equal(manager.status()[0]!.connected, true);
});

test('a secret save restarts only the connectors that use it', async t => {
  const { server, cleanup } = stdioFixture(t);
  const uses = server('uses', [], { BN_TEST: 'pre-${USED}' }), other = server('other', [], { BN_TEST: 'plain' }), later = server('later', [], { BN_TEST: '${LATER}' });
  const servers = { uses: uses.config, other: other.config, later: later.config };
  const manager = new McpManager(servers, { USED: 'one', UNRELATED: 'one' });
  cleanup(manager);
  await bounded(manager.start());
  assert.match(manager.status().find(s => s.name === 'later')!.error!, /Missing environment reference: LATER/);
  const tools = manager.tools();
  assert.deepEqual(manager.status().map(s => s.connected), [true, true, false]);

  await bounded(manager.update(servers, { USED: 'one', UNRELATED: 'two' })); // a secret nobody references
  assert.deepEqual([uses, other, later].map(s => starts(s.log)), [1, 1, 0], 'nothing restarted, the failed one is not retried');
  assert.equal((await run(tools, 'mcp__other__echo')).isError, undefined, 'the tool handed out earlier still works');

  await bounded(manager.update(servers, { USED: 'two', UNRELATED: 'two' })); // the secret `uses` references
  assert.deepEqual([uses, other, later].map(s => starts(s.log)), [2, 1, 0]);
  assert.equal((await run(tools, 'mcp__other__echo')).isError, undefined);

  await bounded(manager.update(servers, { USED: 'two', UNRELATED: 'two', LATER: 'now' })); // a new secret fixes the failed connector
  assert.deepEqual([uses, other, later].map(s => starts(s.log)), [2, 1, 1]);
  assert.deepEqual(manager.status().map(s => [s.connected, s.error]), [[true, undefined], [true, undefined], [true, undefined]]);
});

// A fake streamable-HTTP MCP server whose sessions the test can expire, and which can answer 401.
async function httpFixture(t: TestContext, headers?: Record<string, string>) {
  // holdDelete / holdInitialize: promises a test sets to keep the server's DELETE / initialize reply waiting until it resolves them.
  // From the second initialize on: malformedInitialize answers with the X-Key header value as a broken body; pingOnInitialize answers over SSE
  // with a server ping first. pingOnCall does that for tool calls; rejectReplies answers 404 to the client's reply to such a ping.
  const state = { initializes: 0, deletes: 0, replies: 0, sessions: new Set<string>(), unauthorized: false, alwaysExpired: false,
    malformedInitialize: false, pingOnInitialize: false, pingOnCall: false, rejectReplies: false,
    holdDelete: undefined as Promise<void> | undefined, holdInitialize: undefined as Promise<void> | undefined };
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { state.deletes++; await state.holdDelete; state.sessions.delete(String(req.headers['mcp-session-id'])); res.writeHead(200); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const m = JSON.parse(raw), json = (body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(200, { 'Content-Type': 'application/json', ...headers }); res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: body }));
    }, sse = (body: unknown, headers: Record<string, string> = {}) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', ...headers });
      res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 'srv-ping', method: 'ping' }) + '\n\n');
      res.end('data: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: body }) + '\n\n');
    };
    if (state.unauthorized) { res.writeHead(401); res.end('bad token'); return; }
    if (m.method === 'initialize') {
      state.initializes++;
      const session = `session-${state.initializes}`; state.sessions.add(session);
      await state.holdInitialize;
      const result = { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-fake', version: '1' } };
      if (state.initializes > 1 && state.malformedInitialize) { res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': session }); res.end(String(req.headers['x-key'])); return; }
      if (state.initializes > 1 && state.pingOnInitialize) return sse(result, { 'Mcp-Session-Id': session });
      return json(result, { 'Mcp-Session-Id': session });
    }
    const session = String(req.headers['mcp-session-id']);
    if (state.alwaysExpired || !state.sessions.has(session)) { res.writeHead(404); res.end('unknown session'); return; }
    if (!m.method) { state.replies++; res.writeHead(state.rejectReplies ? 404 : 202); res.end(state.rejectReplies ? 'unknown session' : ''); return; } // the client's reply to our ping
    if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (m.method === 'tools/list') return json({ tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }] });
    const answer = { content: [{ type: 'text', text: `answer from ${session}` }] };
    if (state.pingOnCall) sse(answer); else json(answer);
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const config: McpServerConfig = { transport: 'http', enabled: true, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, ...(headers ? { headers } : {}) };
  const manager = new McpManager({ h: config }, {});
  t.after(async () => { await manager.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); });
  await bounded(manager.start());
  assert.equal(manager.status()[0]!.connected, true);
  return { state, server, config, manager, tools: manager.tools() };
}

test('an expired HTTP session re-initializes once and the call goes through', async t => {
  const { state, manager, tools } = await httpFixture(t);
  assert.equal((await run(tools, 'mcp__h__echo')).content, 'answer from session-1');
  state.sessions.clear(); // the server forgets the session
  const [first, second] = await bounded(Promise.all([run(tools, 'mcp__h__echo'), run(tools, 'mcp__h__echo')])); // two calls hit the expiry together
  assert.deepEqual([first, second].map(r => r.content), ['answer from session-2', 'answer from session-2']);
  assert.equal(state.initializes, 2, 'one new session, not one per call');
  assert.equal(manager.status()[0]!.connected, true);
  assert.equal((await run(tools, 'mcp__h__echo')).content, 'answer from session-2');
  assert.equal(state.initializes, 2);
  state.alwaysExpired = true; // a server that rejects even a fresh session is not retried forever
  const result = await bounded(run(tools, 'mcp__h__echo'));
  assert.equal(result.isError, true); assert.match(result.content, /404/);
  assert.equal(state.initializes, 3);
  assert.equal(manager.status()[0]!.connected, false); assert.match(manager.status()[0]!.error!, /404/);
});

test('an HTTP connector goes down on a dead server or 401, reports why, and an update brings it back', async t => {
  const dead = await httpFixture(t), denied = await httpFixture(t);
  denied.state.unauthorized = true;
  const refused = await bounded(run(denied.tools, 'mcp__h__echo'));
  assert.equal(refused.isError, true); assert.match(refused.content, /401/);
  assert.equal(denied.manager.status()[0]!.connected, false);
  assert.match(denied.manager.status()[0]!.error!, /connector h .*401/);
  assert.deepEqual(denied.manager.tools(), [], 'its tools leave the model');
  denied.state.unauthorized = false;
  await bounded(denied.manager.update({ h: denied.config }));
  assert.equal(denied.manager.status()[0]!.connected, true);
  assert.equal((await run(denied.manager.tools(), 'mcp__h__echo')).isError, undefined);

  dead.server.closeAllConnections(); await new Promise<void>(resolve => dead.server.close(() => resolve()));
  assert.equal((await bounded(run(dead.tools, 'mcp__h__echo'))).isError, true);
  assert.equal(dead.manager.status()[0]!.connected, false);
  assert.match(dead.manager.status()[0]!.error!, /connector h /);
  assert.deepEqual(dead.manager.tools(), []);
});

test('a restart that waits for the old client to close is dropped when the manager stops or the connector is disabled', async t => {
  for (const how of ['stop', 'disable'] as const) {
    const { state, config, manager, tools } = await httpFixture(t);
    state.unauthorized = true;
    assert.equal((await bounded(run(tools, 'mcp__h__echo'))).isError, true); // 401: down, its session still open on the server
    state.unauthorized = false;
    let release!: () => void; state.holdDelete = new Promise<void>(resolve => { release = resolve; });
    const restarting = manager.start(); // the restart first closes the old client, whose session DELETE the server holds back
    await until(() => state.deletes === 1);
    if (how === 'stop') await bounded(manager.stop()); else await bounded(manager.apply({ h: { ...config, enabled: false } }));
    release();
    await bounded(restarting);
    assert.equal(state.initializes, 1, `${how}: no new connection was opened`);
    assert.equal(manager.status()[0]!.connected, false);
    assert.deepEqual(manager.tools(), []);
  }
});

test('a call that starts while the HTTP session is being renewed waits for the new session', async t => {
  const { state, manager, tools } = await httpFixture(t);
  state.sessions.clear();
  let release!: () => void; state.holdInitialize = new Promise<void>(resolve => { release = resolve; });
  const first = run(tools, 'mcp__h__echo'); // 404, then the renewal starts and its initialize reply is held back
  await until(() => state.initializes === 2);
  const second = run(tools, 'mcp__h__echo'); // starts during the renewal: it must not go out without a session
  release();
  assert.deepEqual((await bounded(Promise.all([first, second]))).map(r => r.content), ['answer from session-2', 'answer from session-2']);
  assert.equal(state.initializes, 2, 'one renewal');
  assert.equal(manager.status()[0]!.connected, true);
});

test('a renewal that fails on a malformed reply does not leak a header value into the card or the tool result', async t => {
  const credential = 'topsecret-0123'; // short: V8 quotes a body this short in its JSON parse error
  const { state, manager, tools } = await httpFixture(t, { 'X-Key': credential });
  state.sessions.clear(); state.malformedInitialize = true;
  const result = await bounded(run(tools, 'mcp__h__echo'));
  const { connected, error } = manager.status()[0]!;
  assert.equal(result.isError, true); assert.equal(connected, false);
  assert.match(error!, /connector h /);
  for (const text of [result.content, error!]) assert.ok(!text.includes(credential), `leaked in: ${text}`);
});

test('a server ping inside the renewal initialize reply is answered instead of deadlocking the renewal', async t => {
  const { state, manager, tools } = await httpFixture(t);
  state.sessions.clear(); state.pingOnInitialize = true;
  assert.equal((await bounded(run(tools, 'mcp__h__echo'))).content, 'answer from session-2'); // bounded() is 5 s: the deadlock lasted 60 s
  assert.deepEqual([state.initializes, state.replies, manager.status()[0]!.connected], [2, 1, true]);
});

test('a reply the server rejects with 404 fails that call only: no renewal, the connector stays up', async t => {
  const { state, manager, tools } = await httpFixture(t);
  state.pingOnCall = true; state.rejectReplies = true;
  const result = await bounded(run(tools, 'mcp__h__echo'));
  assert.equal(result.isError, true); assert.match(result.content, /404/);
  assert.deepEqual([state.initializes, manager.status()[0]!.connected], [1, true]);
  state.rejectReplies = false;
  assert.equal((await bounded(run(tools, 'mcp__h__echo'))).content, 'answer from session-1');
});

test('a restarted connector stays starting while its old client closes, and settle() waits for it', async t => {
  const { state, config, manager } = await httpFixture(t);
  assert.equal(manager.status()[0]!.starting, false);
  let release!: () => void; state.holdDelete = new Promise<void>(resolve => { release = resolve; });
  await bounded(manager.apply({ h: { ...config, headers: { 'X-Test': 'two' } } })); // a changed config restarts it; apply does not wait for the DELETE
  await until(() => state.deletes === 1);
  assert.equal(manager.status()[0]!.starting, true, 'no gap without an entry');
  let settled = false;
  const waiting = manager.settle(['h'], LIMIT_MS, new AbortController().signal).then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(settled, false, 'settle() waits for the restart');
  release();
  await bounded(waiting);
  assert.deepEqual([manager.status()[0]!.connected, manager.status()[0]!.starting, state.initializes], [true, false, 2]);
});

test('a call can be cancelled while it waits for a session renewal, and the renewal carries on', async t => {
  const { state, tools } = await httpFixture(t);
  state.sessions.clear();
  let release!: () => void; state.holdInitialize = new Promise<void>(resolve => { release = resolve; });
  const controller = new AbortController();
  const call = tools.find(tool => tool.name === 'mcp__h__echo')!.run({ text: 'hi' }, { ...ctx, signal: controller.signal });
  await until(() => state.initializes === 2); // the 404 came back and the renewal's initialize is held
  controller.abort();
  assert.equal((await bounded(call)).isError, true); // returned although the renewal is still held
  release();
  assert.equal((await bounded(run(tools, 'mcp__h__echo'))).content, 'answer from session-2');
  assert.equal(state.initializes, 2);
});
