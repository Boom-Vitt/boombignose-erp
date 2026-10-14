import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpManager } from '../../src/mcp/manager.ts';
import type { McpServerConfig, ToolResult } from '../../src/types.ts';

const LIMIT_MS = 5000;
const secret = 't09-"fake\\secret-value';
async function bounded<T>(pending: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`MCP operation did not finish within ${LIMIT_MS} ms`)), LIMIT_MS);
    })]);
  } finally { clearTimeout(timer); }
}

async function fixture(t: TestContext, args: string[] = []) {
  const home = mkdtempSync(join(tmpdir(), 'bignose-mcp-exit-'));
  const starts = join(home, 'starts');
  const config: McpServerConfig = { transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('fake-server.ts', import.meta.url)), '--lifecycle', starts, ...args],
    env: { BN_TEST: '${VALUE}', BIGNOSE_HOME: home }, enabled: true };
  const manager = new McpManager({ fake: config }, { VALUE: secret });
  t.after(async () => { await bounded(manager.stop()); rmSync(home, { recursive: true, force: true }); });
  await bounded(manager.start());
  assert.equal(manager.status()[0]?.connected, true);
  const tools = manager.tools();
  const ctx = { sessionId: 'test', origin: { kind: 'cli' as const }, cwd: home, signal: new AbortController().signal, depth: 0 };
  const call = (name: string) => tools.find(tool => tool.name === `mcp__fake__${name}`)!.run({}, ctx);
  return { manager, config, starts, call };
}

function exitError(result: ToolResult) {
  assert.equal(result.isError, true);
  assert.match(result.content, /connector fake exited \(3\)/);
  assert.ok(!result.content.includes(secret));
  assert.ok(!result.content.includes(JSON.stringify(secret).slice(1, -1)));
  assert.match(result.content, /••••/);
}

test('T09 waitFor rejects an established exit promptly and status retains the redacted error', async t => {
  const { manager, call } = await fixture(t);
  await bounded(call('exit'));
  await assert.rejects(manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS)), /connector fake.*exited \(3\)/);
  const status = manager.status()[0]!;
  assert.equal(status.connected, false);
  assert.match(status.error!, /connector fake exited \(3\).*server ending: ••••/);
  assert.ok(!status.error!.includes(secret));
  assert.ok(!status.error!.includes(JSON.stringify(secret).slice(1, -1)));
  assert.equal(manager.status()[0]!.error, status.error);
});

test('T09 a pending tool call fails promptly with the named redacted exit', async t => {
  const { call } = await fixture(t);
  const pending = call('wait');
  await bounded(call('echo')); // The server processed the wait request before this reply.
  await bounded(call('exit'));
  exitError(await bounded(pending));
});

test('T09 a tool handed out before exit rejects later calls without the request timeout', async t => {
  const { call } = await fixture(t);
  await bounded(call('exit'));
  exitError(await bounded(call('echo')));
});

test('T09 exit stays down and stop twice neither throws nor restarts the server', async t => {
  const { manager, starts, call } = await fixture(t);
  await bounded(call('exit'));
  assert.equal(manager.tools().length, 0);
  assert.equal(manager.listTools('fake').length, 7);
  await assert.rejects(manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS)), /connector fake.*exited/);
  await bounded(manager.stop());
  await bounded(manager.stop());
  assert.equal(manager.status()[0]!.connected, false);
  assert.equal(readFileSync(starts, 'utf8'), 'started\n');
});

test('T09 an explicit settings update can restart an exited connector', async t => {
  const { manager, config, starts, call } = await fixture(t);
  await bounded(call('exit'));
  await bounded(manager.update({ fake: config }));
  await manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS));
  assert.equal(manager.status()[0]!.error, undefined);
  assert.equal(readFileSync(starts, 'utf8'), 'started\nstarted\n');
});

test('T09 a settings update that replaces a connector is not reported as closed', async t => {
  const { manager, config, call } = await fixture(t);
  const updating = manager.update({ fake: { ...config, args: [...config.args!, '--banner'] } });
  await manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS));
  await bounded(updating);
  assert.equal(manager.status()[0]!.error, undefined);
  assert.match((await bounded(call('echo'))).content, /connector fake closed/);
});

test('T09 an explicit start clears the exited entry while its replacement starts', async t => {
  const { manager, starts, call } = await fixture(t);
  await bounded(call('exit'));
  const starting = manager.start();
  await manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS));
  await bounded(starting);
  assert.equal(manager.status()[0]!.error, undefined);
  assert.equal(readFileSync(starts, 'utf8'), 'started\nstarted\n');
});

test('T09 a signal exit keeps its signal and redacts stderr', async t => {
  const { manager, call } = await fixture(t, ['--exit-signal']);
  const result = await bounded(call('exit'));
  assert.equal(result.isError, true);
  assert.match(result.content, /connector fake exited \(SIGTERM\)/);
  await assert.rejects(manager.waitFor(['fake'], AbortSignal.timeout(LIMIT_MS)), /connector fake.*exited \(SIGTERM\)/);
  assert.ok(!manager.status()[0]!.error!.includes(secret));
});

test('T09 a tool handed out before stop fails promptly with a named closed error', async t => {
  const { manager, call } = await fixture(t);
  const stopping = manager.stop();
  assert.equal(manager.status()[0]!.error, undefined);
  await bounded(stopping);
  const result = await bounded(call('echo'));
  assert.equal(result.isError, true);
  assert.match(result.content, /connector fake closed/);
});
