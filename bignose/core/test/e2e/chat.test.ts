import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../../src/store/index.ts';
import { maskSecret, setSecret } from '../../src/config.ts';
import { createServer } from 'node:http';
import { cli, configured, mockOpenai, testHome, toolCall } from './helpers.ts';

test('chat -q round trips a builtin tool through a mock OpenAI-compatible server and persists transcript/context', async t => {
  const home = testHome(t); writeFileSync(join(home, 'evidence.txt'), 'tool evidence ไทย');
  const mock = await mockOpenai(t, (req, n) => {
    if (n === 1) return toolCall('read_file', { path: 'evidence.txt' });
    assert.match(req.messages.find((m: any) => m.role === 'tool').content, /tool evidence ไทย/);
    return { content: 'Evidence received.' };
  });
  configured(home, mock.baseUrl);
  const result = await cli(home, ['chat', '-q', 'read my evidence']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout.trim(), 'Evidence received.');
  assert.match(result.stderr, /tool read_file/); assert.equal(mock.requests.length, 2);
  const store = openStore(join(home, 'bignose.db')); t.after(() => store.close());
  const session = store.listSessions()[0]!;
  assert.equal(session.origin.kind, 'cli'); assert.equal(session.title, 'read my evidence');
  const messages = store.getMessages(session.id);
  assert.equal(messages.length, 4); assert.deepEqual(store.getSession(session.id)!.context, messages);
  assert.equal(messages[2]!.content[0]!.type, 'tool_result');
});

test('headless chat denies ask tools without a TTY and reports provider failures with a nonzero exit', async t => {
  const home = testHome(t);
  const mock = await mockOpenai(t, (req, n) => {
    if (n === 1) return toolCall('write_file', { path: 'blocked.txt', content: 'not written' });
    assert.match(req.messages.find((m: any) => m.role === 'tool').content, /denied by user/);
    return { content: 'Permission denied.' };
  });
  configured(home, mock.baseUrl);
  assert.equal((await cli(home, ['chat', '-q', 'write a file'])).code, 0);
  configured(home);
  const failed = await cli(home, ['chat', '-q', 'hello']);
  assert.equal(failed.code, 1); assert.match(failed.stderr, /fetch failed|ECONNREFUSED/);
});

test('CLI MCP commands validate names and persist add/list/enable/disable; doctor reports an unavailable Ollama without a key warning', async t => {
  const home = testHome(t);
  configured(home, undefined, c => { c.providers[0]!.id = 'ollama'; c.active.provider = 'ollama'; });
  const report = await cli(home, ['doctor']);
  assert.equal(report.code, 0);
  assert.match(report.stdout, /warn Ollama is not running/);
  assert.match(report.stdout, /note Ollama picks its own context size/);
  assert.ok(!report.stdout.includes('key is unset'));
  assert.equal((await cli(home, ['mcp', 'add', 'bad__name', '--url', 'http://127.0.0.1:1/mcp'])).code, 1);
  assert.equal((await cli(home, ['mcp', 'add', 'fake', '--url', 'http://127.0.0.1:1/mcp'])).code, 0);
  assert.match((await cli(home, ['mcp', 'list'])).stdout, /fake http enabled/);
  assert.equal((await cli(home, ['mcp', 'disable', 'fake'])).code, 0);
  assert.match((await cli(home, ['mcp', 'list'])).stdout, /fake http disabled/);
  assert.equal((await cli(home, ['mcp', 'enable', 'fake'])).code, 0);
  assert.equal((await cli(home, ['mcp', 'test', 'fake'])).code, 1);
});

test('chat -q never prints a secret split across streamed provider chunks', async t => {
  const home = testHome(t), sensitive = 'private-' + 'y'.repeat(16), prefix = 'ordinary '.repeat(20);
  const server = createServer((req, res) => {
    req.resume(); res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const content of [prefix + sensitive.slice(0, 10), sensitive.slice(10), ' tail']) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content }, finish_reason: null }] })}\n\n`);
    res.end('data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  configured(home, `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`); setSecret('VALUE', sensitive, home);
  const result = await cli(home, ['chat', '-q', 'echo']);
  assert.equal(result.code, 0, result.stderr); assert.equal(result.stdout, prefix + maskSecret(sensitive) + ' tail\n');
  assert.ok(!result.stdout.includes(sensitive));
});
