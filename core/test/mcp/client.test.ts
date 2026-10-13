import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { once } from 'node:events';
import { McpClient } from '../../src/mcp/client.ts';
import { McpManager } from '../../src/mcp/manager.ts';
import type { McpServerConfig } from '../../src/types.ts';

const stdio: McpServerConfig = { transport: 'stdio', command: process.execPath, args: [fileURLToPath(new URL('fake-server.ts', import.meta.url))], env: { BN_TEST: '${VALUE}' }, enabled: true };

test('stdio initializes, answers server ping, follows cursors and keeps tool and RPC errors', async t => {
  const client = new McpClient(stdio, { VALUE: 'overlay-x' });
  t.after(() => client.close());
  await client.connect();
  const tools = await client.listTools();
  assert.deepEqual(tools.map(t => t.name), ['echo', 'fail', 'bad.name', 'bad/name', 'x'.repeat(100)]);
  assert.deepEqual(await client.callTool('echo', { text: 'hello' }), { content: 'hello\n••••|path' });
  assert.deepEqual(await client.callTool('fail', {}), { content: 'tool failed', isError: true });
  assert.match((await client.callTool('unknown', {})).content, /-32601/);
  assert.equal((await client.callTool('unknown', {})).isError, true);
  await client.close();
  assert.equal((await client.callTool('echo', {})).isError, true);
});

test('HTTP accepts JSON and SSE, carries negotiated headers, and answers ping with a new POST', async t => {
  const seen: string[] = []; let ping = false;
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    const m = JSON.parse(raw); seen.push(m.method ?? 'ping-response');
    assert.match(req.headers.accept!, /application\/json.*text\/event-stream/);
    assert.equal(req.headers['x-test'], 'fake');
    if (m.method !== 'initialize') {
      assert.equal(req.headers['mcp-session-id'], 'session-fake');
      assert.equal(req.headers['mcp-protocol-version'], '2025-06-18');
    }
    if (m.method === 'initialize') {
      res.writeHead(200, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'session-fake' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'http-fake', version: '1' } } }));
    } else if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); }
    else if (m.id === 'ping') { ping = true; assert.deepEqual(m.result, {}); res.writeHead(202); res.end(); }
    else if (m.method === 'tools/list') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('id: prime\ndata:\n\n');
      res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', id: 'ping', method: 'ping' }) + '\n\n');
      res.write('data: ' + JSON.stringify({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' }) + '\n\n');
      res.end('data: ' + JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'echo', description: '', inputSchema: { type: 'object' } }] } }) + '\n\n');
    } else {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'http answer' }] } }));
    }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise<void>(resolve => server.close(() => resolve())));
  const client = new McpClient({ transport: 'http', url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, enabled: true, headers: { 'X-Test': '${VALUE}' } }, { VALUE: 'fake' });
  t.after(() => client.close());
  await client.connect();
  assert.equal((await client.listTools()).length, 1);
  assert.equal(ping, true);
  assert.deepEqual(await client.callTool('echo', {}), { content: 'http answer' });
  assert.deepEqual(seen, ['initialize', 'notifications/initialized', 'tools/list', 'ping-response', 'tools/call']);
  await client.close();
});

test('manager filters selections, makes unique legal names, tests disabled servers and reconnects updates', async t => {
  const manager = new McpManager({ 'a.b': { ...stdio, tools: ['echo', 'bad.name', 'bad/name', 'x'.repeat(100)] }, disabled: { ...stdio, enabled: false, command: process.execPath } }, { VALUE: 'manager-x' });
  t.after(() => manager.stop());
  await manager.start();
  assert.equal(manager.status().find(s => s.name === 'disabled')?.connected, false);
  const tools = manager.tools();
  assert.equal(tools.length, 4); assert.equal(new Set(tools.map(t => t.name)).size, 4);
  assert.ok(tools.every(t => /^[a-zA-Z0-9_-]{1,64}$/.test(t.name) && t.defaultPolicy === 'ask'));
  const context = { sessionId: 's', origin: { kind: 'cli' as const }, cwd: '/', signal: new AbortController().signal, depth: 0 };
  assert.equal((await tools.find(t => t.description === 'Echo')!.run({ text: 'hi' }, context)).content, 'hi\n••••|path');
  assert.deepEqual(await manager.test('disabled'), { ok: true, tools: 5 });
  assert.equal((await manager.test('missing')).ok, false);
  assert.equal(manager.status().find(s => s.name === 'disabled')?.connected, false);
  await manager.update({ enabled: { ...stdio, tools: ['fail'] } });
  assert.equal(manager.tools().length, 1); assert.equal(manager.tools()[0]?.name, 'mcp__enabled__fail');
  await manager.stop(); assert.equal(manager.tools().length, 0);
});

test('failed MCP startup and missing secret references return errors and close resources', async () => {
  const manager = new McpManager({ broken: { transport: 'stdio', enabled: true, command: '/does/not/exist' } }, {});
  await manager.start(); assert.equal(manager.status()[0]?.connected, false); assert.ok(manager.status()[0]?.error);
  assert.equal((await manager.test('broken')).ok, false); await manager.stop();
  const client = new McpClient(stdio, {});
  await assert.rejects(client.connect(), /VALUE/); await client.close();
});

test('stdio pending calls interrupt promptly and startup stderr redacts expanded environment values', async t => {
  const client = new McpClient(stdio, { VALUE: 'fake-value' }); t.after(() => client.close());
  await client.connect();
  const controller = new AbortController();
  const pending = client.callTool('wait', {}, controller.signal);
  setTimeout(() => controller.abort(), 20);
  assert.deepEqual(await pending, { content: 'interrupted', isError: true });
  assert.equal((await client.callTool('echo', { text: 'alive' })).content, 'alive\n••••|path');
  const broken = new McpClient({ ...stdio, args: ['-e', 'process.stderr.write(process.env.BN_TEST); process.exit(2)'] }, { VALUE: 'fake-value' });
  await assert.rejects(broken.connect(), e => e instanceof Error && e.message.includes('exited') && !e.message.includes('fake-value'));
  await broken.close();
});

test('MCP tool results redact raw and JSON-escaped expanded environment values without truncating findings', async t => {
  const value = 'fake\\"value';
  const client = new McpClient(stdio, { VALUE: value }); t.after(() => client.close());
  await client.connect();
  const content = 'finding '.repeat(400) + JSON.stringify(value);
  const result = await client.callTool('echo', { text: content });
  assert.equal(result.isError, undefined);
  assert.equal(result.content, 'finding '.repeat(400) + '"••••"\n••••|path');
  assert.ok(!result.content.includes(value));
});

test('stdio tolerates a startup banner and still initializes and calls tools', async t => {
  const client = new McpClient({ ...stdio, args: [...stdio.args!, '--banner'] }, { VALUE: 'overlay-x' });
  t.after(() => client.close());
  await client.connect();
  assert.equal((await client.listTools()).length, 5);
  assert.deepEqual(await client.callTool('echo', { text: 'ready' }), { content: 'ready\n••••|path' });
});

test('MCP aliases stay bound to original tools when server order or selection changes', async t => {
  const selected = ['bad.name', 'bad/name', 'x'.repeat(100)];
  const manager = new McpManager({ aliases: { ...stdio, tools: selected } }, { VALUE: 'overlay-x' });
  t.after(() => manager.stop()); await manager.start();
  const ctx = { sessionId: 's', origin: { kind: 'cli' as const }, cwd: '/', signal: new AbortController().signal, depth: 0 };
  const aliases = async () => Object.fromEntries(await Promise.all(manager.tools().map(async tool => [(await tool.run({}, ctx)).content, tool.name] as const)));
  const first = await aliases();
  assert.equal(Object.keys(first).length, 3);
  assert.ok(Object.values(first).every(name => /^[a-zA-Z0-9_-]{1,64}$/.test(name)));
  await manager.update({ aliases: { ...stdio, args: [...stdio.args!, '--reverse-tools'], tools: selected } });
  assert.deepEqual(await aliases(), first);
  await manager.update({ aliases: { ...stdio, tools: ['bad/name'] } });
  assert.deepEqual(await aliases(), { 'bad/name': first['bad/name'] });
});

test('MCP results and errors preserve short literal values while masking expanded secrets', async t => {
  const config = { ...stdio, env: { ...stdio.env, LEVEL: '1', MODE: 'debug', SHORT: 'a"b"c"d' } };
  const env = { VALUE: 'test-value' };
  const client = new McpClient(config, env); t.after(() => client.close());
  await client.connect();
  const text = 'found 12 matches in 1 file; debug; a"b"c"d; ' + JSON.stringify(config.env.SHORT);
  assert.deepEqual(await client.callTool('echo', { text }), { content: text + '\n••••|path' });
  const broken = new McpClient({ ...config, args: ['-e', 'process.stderr.write("found 12 matches in 1 file; debug; " + process.env.BN_TEST); process.exit(1)'] }, env);
  t.after(() => broken.close());
  await assert.rejects(broken.connect(), e => e instanceof Error
    && e.message.includes('exited (1)') && e.message.includes('found 12 matches in 1 file; debug; ••••') && !e.message.includes(env.VALUE));
});
