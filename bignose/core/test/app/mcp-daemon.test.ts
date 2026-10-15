import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon } from '../../src/app/daemon.ts';
import { Runtime } from '../../src/app/runtime.ts';
import { openStore } from '../../src/store/index.ts';
import { Scheduler } from '../../src/cron/index.ts';
import { McpManager } from '../../src/mcp/manager.ts';
import { readEnv } from '../../src/config.ts';
import { configured, testHome } from '../e2e/helpers.ts';
import type { McpServerConfig } from '../../src/types.ts';

const LIMIT_MS = 30_000; // bounds only stop a hang; a loaded machine is slow
const fakeServer = fileURLToPath(new URL('../mcp/fake-server.ts', import.meta.url));
const stdio = (...args: string[]): McpServerConfig => ({ transport: 'stdio', command: process.execPath, args: [fakeServer, ...args], enabled: true });
async function until(ok: () => boolean) {
  for (const stop = Date.now() + LIMIT_MS; !ok(); await new Promise(resolve => setTimeout(resolve, 10))) if (Date.now() > stop) assert.fail('timed out waiting');
}

test('a slow connector does not block settings writes', async t => {
  const home = testHome(t), gateDir = mkdtempSync(join(tmpdir(), 'bn-gate-')), gate = join(gateDir, 'gate'); // outside `home`, which is removed first
  configured(home, undefined, c => { c.mcp.servers.slow = stdio('--gate', gate); });
  const app = await startDaemon({ home, mcpWaitMs: 1500 });
  t.after(async () => { writeFileSync(gate, ''); await app.close(); rmSync(gateDir, { recursive: true, force: true }); });
  const api = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`http://127.0.0.1:${app.port}${path}`, { method, signal: AbortSignal.timeout(LIMIT_MS),
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    assert.equal(res.status, 200, text);
    return JSON.parse(text);
  };
  const slow = () => app.mcp.status().find(s => s.name === 'slow')!;
  assert.equal(slow().starting, true, 'connectors start with the daemon, before the first reload'); // no waiting for it

  await api('PUT', '/api/secrets', { name: 'UNRELATED_KEY', value: 'fake-secret' }); // each of these hung until the connector finished starting
  await api('POST', '/api/mcp', { name: 'quick', config: stdio() }); // returned although `slow` is stuck
  await until(() => app.mcp.status().find(s => s.name === 'quick')?.connected === true);
  assert.equal(slow().starting, true, 'the slow one is still starting');
  assert.deepEqual((await api('GET', '/api/mcp')).servers.find((s: any) => s.name === 'slow'), { name: 'slow', transport: 'stdio', enabled: true, connected: false, starting: true, tools: [] });

  await api('PATCH', '/api/mcp/slow', { enabled: false }); // the stuck connector can be turned off
  assert.deepEqual([slow().enabled, slow().starting], [false, false]);
  const enabling = Date.now();
  await api('PATCH', '/api/mcp/slow', { enabled: true }); // the write that starts a stuck connector gives up waiting after mcpWaitMs
  assert.ok(Date.now() - enabling >= 1400, 'it waited the full mcpWaitMs for the stuck connector');
  assert.equal(slow().starting, true);
  writeFileSync(gate, '');
  await until(() => slow().connected);
  assert.equal(app.mcp.status().find(s => s.name === 'quick')!.connected, true);
});

test('a chat waits a short bounded time for a connector that is still starting', async t => {
  const home = testHome(t);
  const config = configured(home, undefined, c => { c.mcp.servers.fake = { ...stdio('--delay-init'), tools: ['echo'] }; });
  const store = openStore(join(home, 'store.db')), mcp = new McpManager(config.mcp.servers, readEnv(home));
  const offered: string[][] = [];
  let runtime: Runtime;
  const scheduler = new Scheduler({ store, onFire: job => runtime.fireJob(job) });
  runtime = new Runtime({ home, store, mcp, scheduler, config: () => config, line: () => undefined, providerFactory: () => ({ kind: 'openai-compatible', async *stream(req) {
    offered.push(req.tools.map(tool => tool.name));
    yield { type: 'text_delta', text: 'ok' }; yield { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 0, outputTokens: 0 } };
  } }) });
  t.after(async () => { scheduler.stop(); await runtime.close(); await mcp.stop(); store.close(); });
  void mcp.start(); // the daemon boots like this: the chat arrives while the connector is still initializing
  assert.equal(mcp.status().find(s => s.name === 'fake')!.starting, true);
  const session = store.createSession({ origin: { kind: 'desktop' }, agentId: store.listAgents()[0]!.id });
  assert.equal((await runtime.start(session.id, 'hello').result).status, 'done');
  assert.ok(offered[0]!.includes('mcp__fake__echo'), `offered: ${offered[0]!.join(', ')}`);
});
