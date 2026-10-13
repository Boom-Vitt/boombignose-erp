import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { openStore } from '../../src/store/index.ts';
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

test('CLI MCP commands validate names and persist add/list/enable/disable; doctor warns on missing credentials', async t => {
  const home = testHome(t);
  assert.equal((await cli(home, ['doctor'])).code, 0);
  assert.match((await cli(home, ['doctor'])).stdout, /warn active provider key is unset/);
  assert.equal((await cli(home, ['mcp', 'add', 'bad__name', '--url', 'http://127.0.0.1:1/mcp'])).code, 1);
  assert.equal((await cli(home, ['mcp', 'add', 'fake', '--url', 'http://127.0.0.1:1/mcp'])).code, 0);
  assert.match((await cli(home, ['mcp', 'list'])).stdout, /fake http enabled/);
  assert.equal((await cli(home, ['mcp', 'disable', 'fake'])).code, 0);
  assert.match((await cli(home, ['mcp', 'list'])).stdout, /fake http disabled/);
  assert.equal((await cli(home, ['mcp', 'enable', 'fake'])).code, 0);
  assert.equal((await cli(home, ['mcp', 'test', 'fake'])).code, 1);
});
