// Built desktop UI → real daemon → scripted provider → fake stdio REA. No browser dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { configured, mockOpenai, toolCall } from '../../core/test/e2e/helpers.ts';
import { createApi } from '../src/api.ts';

const root = fileURLToPath(new URL('../../', import.meta.url));
async function until<T>(read: () => T | Promise<T>, label: string, timeout = 20_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}

// A request/response CDP socket, scoped to this test's page.
async function connect(url: string) {
  const socket = new WebSocket(url);
  await Promise.race([once(socket, 'open'), once(socket, 'error').then(() => { throw new Error('CDP connection failed'); })]);
  let sequence = 0;
  const pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  const errors: string[] = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data));
    if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    const wait = pending.get(message.id);
    if (!wait) return;
    pending.delete(message.id);
    if (message.error) wait.reject(new Error(message.error.message)); else wait.resolve(message.result);
  });
  socket.addEventListener('close', () => { for (const p of pending.values()) p.reject(new Error('CDP closed')); pending.clear(); });
  const call = (method: string, params: Record<string, unknown> = {}): Promise<any> => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 10_000);
    pending.set(id, { resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async (expression: string) => {
    const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  };
  return { call, evaluate, errors, close: () => socket.close() };
}

test('create/edit/duplicate/delete an agent and run /rea with approvals and SSE replay in the built UI', { timeout: 120_000 }, async t => {
  const home = mkdtempSync(join(tmpdir(), 'bn-'));
  const children: ChildProcess[] = [];
  let closeCdp = () => {};
  t.after(async () => {
    closeCdp();
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const closed = once(child, 'close');
      try { process.kill(-child.pid!, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
      const timer = setTimeout(() => { try { process.kill(-child.pid!, 'SIGKILL'); } catch {} }, 3000);
      await closed; clearTimeout(timer);
    }));
    rmSync(home, { recursive: true, force: true, maxRetries: 3 });
  });
  const target = join(root, 'desktop/e2e/fixtures/target.js');
  const names = ['mcp__rea__open_binary', 'mcp__rea__analyze_javascript_application'];
  const mock = await mockOpenai(t, (req, call) => {
    assert.equal(req.model, 'test-model');
    if (call <= 2) {
      assert.ok(req.tools.some((tool: any) => tool.function.name === names[call - 1]));
      if (call === 2) assert.match(req.messages.find((m: any) => m.role === 'tool').content, /open_binary: fixture evidence/);
      return toolCall(names[call - 1]!, { path: target }, `step-${call}`);
    }
    assert.equal(call, 3);
    assert.ok(req.messages.filter((m: any) => m.role === 'tool').every((m: any) => m.content.includes('fixture evidence')));
    return { content: 'Reverse complete: local fixture evidence verified.' };
  });
  configured(home, mock.baseUrl, c => {
    c.mcp.servers.rea = { transport: 'stdio', command: process.execPath, args: [join(root, 'desktop/e2e/fixtures/rea-server.ts')], enabled: false };
  });
  function child(command: string, args: string[], env = process.env) {
    const processHandle = spawn(command, args, { cwd: root, env, stdio: ['ignore', 'ignore', 'pipe'], detached: true });
    let diagnostic = '';
    processHandle.stderr?.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4000); });
    processHandle.on('error', error => { diagnostic = error.message; });
    children.push(processHandle);
    return { processHandle, diagnostic: () => diagnostic };
  }
  const daemon = child(process.execPath, ['core/src/cli.ts', 'daemon'], { ...process.env, BIGNOSE_HOME: home });
  await until(() => {
    if (daemon.processHandle.exitCode !== null) throw new Error(`Daemon stopped: ${daemon.diagnostic()}`);
    return existsSync(join(home, 'daemon.json'));
  }, 'daemon ready');
  const { port } = JSON.parse(readFileSync(join(home, 'daemon.json'), 'utf8'));
  const token = readFileSync(join(home, 'api-token'), 'utf8').trim();
  const api = createApi({ port, token });
  const staticServer = createServer((req, res) => {
    const path = resolve(root, 'desktop/dist', '.' + new URL(req.url!, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(join(root, 'desktop/dist') + '/') || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.setHeader('Content-Type', mime[extname(path)] ?? 'text/plain'); res.end(readFileSync(path));
  });
  await new Promise<void>(resolve => staticServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { staticServer.close(() => resolve()); staticServer.closeAllConnections(); }));
  const chromePath = process.env.BIGNOSE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.ok(existsSync(chromePath), `Chrome missing: ${chromePath}`);
  const profile = join(home, 'chrome');
  const chrome = child(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-web-security', `--user-data-dir=${profile}`, 'about:blank']);
  await until(() => {
    if (chrome.processHandle.exitCode !== null) throw new Error(`Chrome stopped: ${chrome.diagnostic()}`);
    return existsSync(join(profile, 'DevToolsActivePort'));
  }, 'Chrome DevTools');
  const debugPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()) as { type: string; webSocketDebuggerUrl: string }[];
  const cdp = await connect(pages.find(p => p.type === 'page')!.webSocketDebuggerUrl);
  closeCdp = cdp.close;
  await cdp.call('Page.enable'); await cdp.call('Runtime.enable');
  await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI__ = {core:{invoke:async()=>(${JSON.stringify({ port, token, spawned: false })})}};` });
  await cdp.call('Page.navigate', { url: `http://127.0.0.1:${(staticServer.address() as { port: number }).port}/` });
  const wait = (expression: string, label = expression) => until(() => cdp.evaluate(expression), label);
  const click = async (label: string, scope = 'document') => {
    await wait(`Array.from((${scope})?.querySelectorAll('button,a') ?? []).some(b=>b.textContent===${JSON.stringify(label)} && !b.disabled)`);
    await cdp.evaluate(`Array.from(${scope}.querySelectorAll('button,a')).find(b=>b.textContent===${JSON.stringify(label)} && !b.disabled).click()`);
  };
  const fill = (selector: string, value: string) => cdp.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const field = (label: string, value: string) => cdp.evaluate(`(()=>{const e=Array.from(document.querySelectorAll('.agent-form label')).find(l=>l.querySelector('.field-label')?.textContent===${JSON.stringify(label)}).querySelector('input,textarea,select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`document.querySelector('.nav-conn')?.textContent==='Connected'`);
  await click('Agents'); await click('Create agent');
  await field('Name', 'Hermes Reverser'); await field('Instructions', 'Inspect local apps with evidence.');
  // A restricted list exercises both the global connector toggle and the agent PATCH.
  await cdp.evaluate(`Array.from(document.querySelectorAll('.agent-form legend')).find(e=>e.textContent==='Connectors').parentElement.querySelector('input').click()`);
  await click('Create agent', `document.querySelector('.agent-form')`);
  const created = await until(async () => (await api.listAgents()).agents.find(a => a.name === 'Hermes Reverser'), 'created agent');
  const card = `document.querySelector('[data-agent-id="${created.id}"]')`;
  await click('Edit', card); await field('Icon', '🔎'); await field('Instructions', 'Evidence only <script>unsafe()</script>.');
  await click('Save agent');
  await until(async () => { const a = await api.getAgent(created.id); return a.icon === '🔎' && a.instructions === 'Evidence only <script>unsafe()</script>.'; }, 'persisted edits');
  await click('Duplicate', card);
  const copy = await until(async () => (await api.listAgents()).agents.find(a => a.name === 'Hermes Reverser copy'), 'duplicate');
  assert.equal(copy.instructions, 'Evidence only <script>unsafe()</script>.'); assert.equal(copy.icon, '🔎');
  const copyCard = `document.querySelector('[data-agent-id="${copy.id}"]')`;
  await click('Delete', copyCard); await click('Delete with sessions, agent notes and schedules?', copyCard);
  await until(async () => !(await api.listAgents()).agents.some(a => a.id === copy.id), 'copy deleted');
  await click('Chat', card);
  await wait(`document.querySelector('[aria-label="Chat agent"]')?.value===${JSON.stringify(created.id)}`);
  await fill('[aria-label="Message"]', '/');
  await wait(`!document.querySelector('.slash-picker').hidden && document.querySelector('.slash-picker').textContent.includes('/rea')`);
  await cdp.evaluate(`Array.from(document.querySelectorAll('.slash-option')).find(b=>b.querySelector('strong').textContent==='/rea').click()`);
  await fill('[aria-label="Message"]', `/rea ${target}`); await click('Send');
  await wait(`document.querySelector('.connector-confirm')?.textContent.includes('Turn on rea for Hermes Reverser?')`);
  assert.equal((await api.getSettings()).config.mcp.servers.rea!.enabled, false);
  await click('Turn on');
  await wait(`document.querySelector('.approval')?.textContent.includes('mcp__rea__open_binary')`);
  // Reload with a pending approval: the new SSE stream must replay run_start and the approval.
  await cdp.call('Page.reload');
  await wait(`document.querySelector('.nav-conn')?.textContent==='Connected'`);
  await cdp.evaluate(`(()=>{const e=document.querySelector('[aria-label="Chat agent"]');e.value=${JSON.stringify(created.id)};e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await wait(`document.querySelector('.session-list .session')`);
  await cdp.evaluate(`document.querySelector('.session-list .session').click()`);
  await wait(`document.querySelector('.approval')?.textContent.includes('mcp__rea__open_binary')`);
  assert.equal(await cdp.evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Stop').hidden`), false);
  await click('Allow', `document.querySelector('.approval')`);
  await wait(`Array.from(document.querySelectorAll('.approval')).some(a=>a.textContent.includes('mcp__rea__analyze_javascript_application'))`);
  await click('Allow', `Array.from(document.querySelectorAll('.approval')).find(a=>a.textContent.includes('mcp__rea__analyze_javascript_application'))`);
  await wait(`document.querySelector('.messages').textContent.includes('Reverse complete: local fixture evidence verified.')`);
  await wait(`document.querySelector('.messages').textContent.includes('Report saved:')`);
  for (const name of names) assert.ok(await cdp.evaluate(`Array.from(document.querySelectorAll('.tool-name')).some(e=>e.textContent===${JSON.stringify(name)})`));
  assert.deepEqual((await api.getAgent(created.id)).connectors, ['rea']);
  assert.equal((await api.getSettings()).config.mcp.servers.rea!.enabled, true);
  assert.equal(mock.requests.length, 3);
  assert.deepEqual(cdp.errors, []);
});
