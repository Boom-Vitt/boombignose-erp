#!/usr/bin/env node
// BigNose OS smoke (the one serialized Docker check): the pieces the app launches, run without the app.
//   1. `stack.mjs up` against the local boombignose-erp stack (non-destructive: never a reset, never a stop)
//   2. the ERP served from a temp cache dir on a free port answers /login
//   3. a BigNose daemon (temp BIGNOSE_HOME, free ports, the erp connector) lists the 8 ERP tools over GET /api/mcp/erp/tools
//   4. the ERP MCP server answers list_workspaces against the local stack
// It stops what it started and leaves the stack running. Never uses port 3100 or ~/.bignose; no key or token is printed.
// Needs Docker running, a network for the first ERP build (Google Fonts), and takes a few minutes.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const stack = join(repo, 'scripts/local/stack.mjs');
const mcpServer = join(repo, 'lib/mcp/erp-server.mjs');
const daemonCli = join(repo, 'bignose/core/src/cli.ts');
const TOOLS = ['finance_summary', 'get_customer', 'get_invoice', 'get_order', 'get_product', 'list_clients', 'list_deals', 'list_invoices', 'list_payment_claims', 'list_projects', 'list_quotes', 'list_workspaces'];
const BUILD_TIMEOUT_MS = 20 * 60_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let failures = 0;
const pass = (name) => console.log(`ok - ${name}`);
const fail = (name, detail = '') => { failures += 1; console.log(`not ok - ${name}${detail ? `\n    ${String(detail).split('\n').join('\n    ')}` : ''}`); };

// the children get the caller's environment minus any model key: the smoke never calls a model
const childEnv = (extra = {}) => { const env = { ...process.env, ...extra }; delete env.OPENROUTER_API_KEY; return env; };

const children = []; // { child, group }
function track(child, group = false) { children.push({ child, group }); return child; }
function stopChild({ child, group }) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  try { process.kill(group ? -child.pid : child.pid, 'SIGTERM'); } catch { /* already gone */ }
}
const tmp = mkdtempSync(join(tmpdir(), 'bn-os-smoke-'));
let cleaned = false;
async function cleanup() {
  if (cleaned) return;
  cleaned = true;
  for (const c of children.reverse()) stopChild(c);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline && children.some(({ child }) => child.exitCode === null && child.signalCode === null)) await sleep(100);
  for (const { child, group } of children) {
    if (child.exitCode === null && child.signalCode === null) { try { process.kill(group ? -child.pid : child.pid, 'SIGKILL'); } catch { /* gone */ } }
  }
  rmSync(tmp, { recursive: true, force: true });
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void cleanup().then(() => process.exit(130)); });

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
  });
}

/** Last `n` lines of what a child printed, for a failure message. */
function collect(child) {
  const lines = [];
  for (const stream of [child.stdout, child.stderr]) {
    if (stream) createInterface({ input: stream }).on('line', (l) => { lines.push(l); if (lines.length > 40) lines.shift(); });
  }
  return { tail: (n = 8) => lines.slice(-n).join('\n'), lines };
}

async function until(read, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out: ${label}`);
    await sleep(250);
  }
}

async function api(port, token, path) {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
  return { status: res.status, body: await res.json().catch(() => undefined) };
}

async function step(name, run) {
  try { await run(); } catch (e) { fail(name, e instanceof Error ? e.message : e); return false; }
  return true;
}

async function main() {
  for (const file of [stack, mcpServer, daemonCli]) if (!existsSync(file)) return fail('files', `missing ${file}`);

  // 1. the local stack, started if it is not running (migration up only)
  const up = spawnSync(process.execPath, [stack, 'up'], { cwd: repo, env: childEnv(), encoding: 'utf8', timeout: 10 * 60_000 });
  if (up.status !== 0) {
    return fail('stack up', `exit ${up.status}${up.status === 3 ? ' (Docker is not running)' : ''}\n${`${up.stdout}${up.stderr}`.trim().split('\n').slice(-8).join('\n')}`);
  }
  pass('stack up (the local stack is running; nothing was reset or stopped)');

  // 2. the ERP from a temp cache dir on a free port
  const erpPort = await freePort();
  const serve = track(spawn(process.execPath, [stack, 'serve', '--port', String(erpPort), '--cache-dir', join(tmp, 'erp')],
    { cwd: repo, env: childEnv(), stdio: ['ignore', 'pipe', 'pipe'], detached: true }), true);
  const serveOut = collect(serve);
  const ready = await step('ERP serve', async () => {
    await until(() => {
      if (serve.exitCode !== null) throw new Error(`serve exited (${serve.exitCode})\n${serveOut.tail()}`);
      return serveOut.lines.includes(`ready http://127.0.0.1:${erpPort}`);
    }, 'ERP ready', BUILD_TIMEOUT_MS);
    const res = await fetch(`http://127.0.0.1:${erpPort}/login`, { signal: AbortSignal.timeout(10_000) });
    const html = await res.text();
    if (res.status !== 200 || !html.includes('<html')) throw new Error(`GET /login answered ${res.status}`);
  });
  if (ready) pass(`the ERP answers /login on a free port (${erpPort}) from a temp cache dir`);

  // 3. a daemon with a temp home and the erp connector lists the 8 tools
  const home = join(tmp, 'home');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const apiPort = await freePort(), linePort = await freePort();
  writeFileSync(join(home, 'config.json'), JSON.stringify({
    version: 1, api: { port: apiPort }, line: { port: linePort },
    mcp: { servers: { erp: { transport: 'stdio', command: process.execPath, args: [mcpServer], enabled: true } } },
  }), { mode: 0o600 });
  const daemon = track(spawn(process.execPath, [daemonCli, 'daemon'], { cwd: home, env: childEnv({ BIGNOSE_HOME: home }), stdio: ['ignore', 'pipe', 'pipe'] }));
  const daemonOut = collect(daemon);
  await step('daemon tools', async () => {
    const token = await until(() => {
      if (daemon.exitCode !== null) throw new Error(`daemon exited (${daemon.exitCode})\n${daemonOut.tail()}`);
      return existsSync(join(home, 'api-token')) && readFileSync(join(home, 'api-token'), 'utf8').trim();
    }, 'daemon token', 30_000);
    await until(async () => (await api(apiPort, token, '/api/health').catch(() => ({}))).status === 200, 'daemon health', 30_000);
    const names = await until(async () => {
      const r = await api(apiPort, token, '/api/mcp/erp/tools').catch(() => ({}));
      const found = r.body?.tools?.map((t) => t.name).sort() ?? [];
      return found.length ? found : false;
    }, 'erp tools', 60_000);
    if (JSON.stringify(names) !== JSON.stringify(TOOLS)) throw new Error(`tools are ${names.join(', ')}`);
    pass(`the daemon lists the ${names.length} ERP tools through GET /api/mcp/erp/tools`);
  });

  // 4. the MCP server answers list_workspaces from the local stack (counts only: no customer data is printed)
  await step('mcp list_workspaces', async () => {
    const mcp = track(spawn(process.execPath, [mcpServer], { env: childEnv(), stdio: ['pipe', 'pipe', 'pipe'] }));
    collect(mcp);
    const pending = new Map();
    createInterface({ input: mcp.stdout }).on('line', (line) => {
      try { const m = JSON.parse(line); pending.get(m.id)?.(m); } catch { /* not a JSON-RPC line */ }
    });
    const call = (id, method, params) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`no answer to ${method}`)), 60_000);
      pending.set(id, (m) => { clearTimeout(timer); resolve(m); });
      mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
    await call(1, 'initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'os-smoke', version: '0' } });
    mcp.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
    const reply = await call(2, 'tools/call', { name: 'list_workspaces', arguments: {} });
    if (reply.error || reply.result?.isError) throw new Error(`list_workspaces failed: ${JSON.stringify(reply.error ?? reply.result.content).slice(0, 300)}`);
    const data = JSON.parse(reply.result.content[0].text);
    if (!Array.isArray(data.items) || typeof data.total !== 'number') throw new Error('list_workspaces did not return { items, total }');
    mcp.stdin.end();
    pass(`the MCP server answers list_workspaces against the local stack (${data.total} workspace${data.total === 1 ? '' : 's'})`);
  });
}

try { await main(); } catch (e) { fail('smoke', e instanceof Error ? e.stack : e); }
finally { await cleanup(); }
console.log(failures ? `\nos-smoke: ${failures} check${failures === 1 ? '' : 's'} failed` : '\nos-smoke: all checks passed (the stack is still running)');
process.exit(failures ? 1 : 0);
