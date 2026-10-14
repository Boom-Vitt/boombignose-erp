import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import { startDaemon } from '../../src/app/daemon.ts';
import type { Message, Provider, ProviderRequest } from '../../src/types.ts';
import { configured, testHome } from '../e2e/helpers.ts';

const LINE_HINT = 'You are replying in a LINE chat. Write plain text: short paragraphs, no Markdown headings, tables or bold markers, and put each URL on its own line. Keep answers brief unless the user asks for detail.';

test('only LINE-origin runs get the plain-text system paragraph', async t => {
  const home = testHome(t); process.env.BIGNOSE_HOME = home; configured(home, undefined, c => { c.line.allow.users = ['Uowner']; });
  const systems: string[] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req: ProviderRequest) {
    systems.push(req.system); yield { type: 'text_delta', text: 'answer' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider }); t.after(() => a.close());
  assert.equal(await a.runtime.lineMessage({ to: 'Uowner', userId: 'Uowner', text: 'hi' }), 'answer');
  for (const origin of [{ kind: 'desktop' } as const, { kind: 'cli' } as const, { kind: 'cron', jobId: 'job' } as const]) {
    const session = a.runtime.store.createSession({ origin, agentId: a.runtime.store.listAgents()[0]!.id }); await a.runtime.start(session.id, 'hi', { origin }).result;
  }
  assert.ok(systems[0]!.includes(LINE_HINT));
  for (const system of systems.slice(1)) assert.equal(system.includes(LINE_HINT), false);
});

test('daemon close interrupts an active run before a hung HTTP MCP shutdown completes', async t => {
  const home = testHome(t); process.env.BIGNOSE_HOME = home;
  let deleting = false;
  const server = createServer(async (req, res) => {
    if (req.method === 'DELETE') { deleting = true; return; }
    let raw = ''; for await (const c of req) raw += c;
    const rpc = JSON.parse(raw);
    if (!rpc.id) { res.writeHead(202); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'fake-session' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result: rpc.method === 'initialize'
      ? { protocolVersion: '2025-03-26', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } : { tools: [] } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  configured(home, undefined, c => { c.mcp.servers.slow = { transport: 'http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, enabled: true }; });
  let started = false, aborted = false;
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    started = true;
    await new Promise<void>(resolve => req.signal!.addEventListener('abort', () => { aborted = true; resolve(); }, { once: true }));
  } };
  const a = await startDaemon({ home, providerFactory: () => provider }); t.after(() => a.close());
  for (let i = 0; !a.mcp.status().find(s => s.name === 'slow')?.connected && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(a.mcp.status().find(s => s.name === 'slow')?.connected, true);
  const session = a.runtime.store.createSession({ origin: { kind: 'desktop' }, agentId: a.runtime.store.listAgents()[0]!.id });
  const run = a.runtime.start(session.id, 'wait');
  for (let i = 0; !started && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(started, true);
  let closed = false;
  const closing = a.close().then(() => { closed = true; });
  const early = await Promise.race([run.result, new Promise<null>(resolve => { const timer = setTimeout(() => resolve(null), 500); timer.unref(); })]);
  try {
    assert.ok(early, 'the run must settle while DELETE is still hanging');
    assert.equal(early.status, 'interrupted'); assert.equal(aborted, true); assert.equal(closed, false);
    for (let i = 0; !deleting && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(deleting, true); assert.equal(closed, false);
  } finally { await closing; }
});

test('non-owner group turns preserve the full owner context and store only the new user and final text', async t => {
  const home = testHome(t); process.env.BIGNOSE_HOME = home;
  configured(home, undefined, c => { c.line.allow = { users: ['Uowner'], groups: ['Cgroup'], rooms: [] }; });
  const requests: Message[][] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    requests.push(structuredClone(req.messages));
    if (requests.length === 1) {
      yield { type: 'text_delta', text: 'intermediate' };
      yield { type: 'tool_call', id: 'guest-call', name: 'read_file', input: { path: 'visitor.txt' } };
    } else yield { type: 'text_delta', text: 'final answer' };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider }); t.after(() => a.close());
  const session = a.runtime.store.createSession({ origin: { kind: 'line', to: 'Cgroup' }, agentId: a.runtime.store.listAgents()[0]!.id });
  const prior: Message[] = [
    { role: 'user', content: [{ type: 'text', text: '[Summary of earlier conversation]\nowner private summary' }] },
    { role: 'user', content: [{ type: 'text', text: 'owner question' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'owner-call', name: 'read_file', input: { path: 'owner-private.txt' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'owner-call', content: 'private tool output' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'owner final answer' }] },
  ];
  a.runtime.store.setContext(session.id, prior);
  assert.equal(await a.runtime.lineMessage({ to: 'Cgroup', userId: 'Uguest', text: 'guest question' }), 'final answer');
  assert.deepEqual(requests[0], [prior[1], prior[4], { role: 'user', content: [{ type: 'text', text: 'guest question' }] }]);
  assert.deepEqual(a.runtime.store.getSession(session.id)!.context, [...prior,
    { role: 'user', content: [{ type: 'text', text: 'guest question' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'final answer' }] },
  ]);
});

test('LINE /rea errors reply with usage or missing path, and still give the connector hint', async t => {
  const home = testHome(t); process.env.BIGNOSE_HOME = home; configured(home, undefined, c => { c.line.allow.users = ['Uowner']; });
  const a = await startDaemon({ home, providerFactory: () => { throw new Error('slash errors must not call the provider'); } }); t.after(() => a.close());
  const ask = (text: string) => a.runtime.lineMessage({ to: 'Uowner', userId: 'Uowner', text });
  assert.equal(await ask('/rea'), 'usage: /rea <app or file path>');
  assert.equal(await ask('/rea missing.app'), `not found: ${join(home, 'missing.app')}`);
  writeFileSync(join(home, 'existing.app'), 'fake');
  assert.equal(await ask('/rea existing.app'), 'Turn on the rea connector for this agent in the app, then send again.');
});

test('a non-owner error after a tool round stores no partial assistant answer in context', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.line.allow.groups = ['Cgroup']; });
  let calls = 0;
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    if (++calls === 2) throw new Error('mock failure');
    yield { type: 'text_delta', text: 'partial text the group never saw' };
    yield { type: 'tool_call', id: 'guest', name: 'read_file', input: { path: 'visitor.txt' } };
    yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const app = await startDaemon({ home, providerFactory: () => provider }); t.after(() => app.close());
  const session = app.runtime.store.createSession({ origin: { kind: 'line', to: 'Cgroup' }, agentId: app.runtime.store.listAgents()[0]!.id });
  assert.equal(await app.runtime.lineMessage({ to: 'Cgroup', userId: 'Uguest', text: 'guest question' }), 'Error: mock failure');
  assert.equal(calls, 2);
  assert.deepEqual(app.runtime.store.getSession(session.id)!.context, [{ role: 'user', content: [{ type: 'text', text: 'guest question' }] }]);
});

test('a LINE message during a desktop run of the same session is answered after it', async t => {
  const home = testHome(t); process.env.BIGNOSE_HOME = home; configured(home, undefined, c => { c.line.allow.users = ['Uowner']; });
  const gate = Promise.withResolvers<void>(); t.after(() => gate.resolve());
  const seen: string[][] = [];
  const provider: Provider = { kind: 'openai-compatible', async *stream(req) {
    seen.push(req.messages.flatMap(m => m.content.flatMap(b => b.type === 'text' ? [b.text] : [])));
    if (seen.length === 2) await gate.promise; // the desktop follow-up
    yield { type: 'text_delta', text: `answer ${seen.length}` };
    yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider }); t.after(() => a.close());
  const ask = (text: string) => a.runtime.lineMessage({ to: 'Uowner', userId: 'Uowner', text });
  assert.equal(await ask('hello from LINE'), 'answer 1');
  const session = a.runtime.store.findSessionByOrigin({ kind: 'line', to: 'Uowner' }, a.runtime.lineAgent().id)!;
  const desktop = a.runtime.start(session.id, 'desktop follow-up');
  assert.throws(() => a.runtime.start(session.id, 'x'), /already running/);
  let answered = false;
  const line = ask('second from LINE').then(r => { answered = true; return r; });
  for (let i = 0; seen.length < 2 && i < 200; i++) await new Promise(resolve => setTimeout(resolve, 5));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(answered, false); assert.equal(seen.length, 2); // waiting, not failed and not started
  gate.resolve();
  assert.equal((await desktop.result).text, 'answer 2');
  assert.equal(await line, 'answer 3');
  assert.ok(seen[2]!.includes('desktop follow-up') && seen[2]!.at(-1) === 'second from LINE', 'the LINE message sees the desktop turn');
});
