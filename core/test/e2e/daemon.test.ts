import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { once } from 'node:events';
import { cliFile, configured, testHome } from './helpers.ts';
import { setSecret } from '../../src/config.ts';

test('daemon starts on a bound loopback port, authenticates health, and stops cleanly on SIGTERM', async t => {
  const home = testHome(t); configured(home);
  const child = spawn(process.execPath, [cliFile.pathname, 'daemon'], { env: { ...process.env, BIGNOSE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit');
  let stderr = ''; child.stderr.on('data', c => { stderr += c; }); child.stdout.resume();
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; } });
  const deadline = Date.now() + 10_000;
  while (!existsSync(join(home, 'daemon.json'))) {
    assert.ok(child.exitCode === null && Date.now() < deadline, stderr);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
  assert.equal(info.pid, child.pid); assert.ok(info.port > 0); assert.equal(typeof info.startedAt, 'number');
  const base = `http://127.0.0.1:${info.port}`, token = readFileSync(join(home, 'api-token'), 'utf8').trim();
  assert.equal((await fetch(base + '/api/health')).status, 401);
  const health = await fetch(base + '/api/health', { headers: { Authorization: `Bearer ${token}` } });
  assert.deepEqual(await health.json(), { ok: true, version: info.version, pid: child.pid });
  child.kill('SIGTERM');
  const stopped = await Promise.race([exit, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('daemon did not stop')), 5000); timer.unref(); })]);
  assert.deepEqual(stopped, [0, null]); assert.equal(existsSync(join(home, 'daemon.json')), false);
});

test('API and LINE start during hung MCP initialization; shutdown waits for a complete PID and closes both children', async t => {
  const kill = process.kill.bind(process);
  t.mock.method(process, 'kill', (pid: number, signal?: NodeJS.Signals | number) => {
    assert.notEqual(pid, 0, 'a PID file must never target the test process group');
    return kill(pid, signal);
  });
  const home = testHome(t), pidFile = join(home, 'mcp-pid');
  configured(home, undefined, c => {
    c.line.enabled = true;
    c.mcp.servers.waiting = { transport: 'stdio', command: process.execPath,
      // Exercise the interval between file creation and complete PID publication.
      args: ['-e', [
        'const fs=require("node:fs");fs.writeFileSync(process.argv[1],"");',
        'setTimeout(()=>fs.writeFileSync(process.argv[1],String(process.pid)+"\\n"),100);',
        'process.stdin.resume()',
      ].join(''), pidFile], enabled: true };
  });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  const child = spawn(process.execPath, [cliFile.pathname, 'daemon'], { env: { ...process.env, BIGNOSE_HOME: home }, stdio: ['ignore', 'pipe', 'pipe'] });
  const exit = once(child, 'exit'); child.stdout.resume(); child.stderr.resume();
  t.after(async () => { if (child.exitCode === null && child.signalCode === null) { child.kill('SIGKILL'); await exit; } });
  const deadline = Date.now() + 5000;
  let pid = 0;
  while (!Number.isSafeInteger(pid) || pid <= 0) {
    assert.ok(Date.now() < deadline && child.exitCode === null && child.signalCode === null, 'MCP did not publish a complete PID');
    const text = existsSync(pidFile) ? readFileSync(pidFile, 'utf8') : '';
    if (/^[1-9]\d*\n$/.test(text)) pid = Number(text);
    if (!Number.isSafeInteger(pid) || pid <= 0) await new Promise(resolve => setTimeout(resolve, 10));
  }
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* Already closed by daemon. */ } });
  assert.equal(existsSync(join(home, 'daemon.json')), true);
  const info = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
  const headers = { Authorization: `Bearer ${readFileSync(join(home, 'api-token'), 'utf8').trim()}` };
  const base = `http://127.0.0.1:${info.port}`;
  assert.equal((await fetch(base + '/api/health', { headers })).status, 200);
  const line = await (await fetch(base + '/api/line/status', { headers })).json() as any;
  assert.equal(line.running, true); assert.ok(line.port > 0);
  const connectors = await (await fetch(base + '/api/mcp', { headers })).json() as any;
  assert.equal(connectors.servers.find((s: any) => s.name === 'waiting').connected, false);
  child.kill('SIGTERM');
  const result = await Promise.race([exit, new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('startup shutdown timed out')), 3000); timer.unref(); })]);
  assert.deepEqual(result, [0, null]);
  assert.throws(() => process.kill(pid, 0), (e: any) => e.code === 'ESRCH');
  assert.equal(existsSync(join(home, 'daemon.json')), false);
});
