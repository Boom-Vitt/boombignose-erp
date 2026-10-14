import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import type { TestContext } from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
export async function until<T>(read: () => T | Promise<T>, label: string, timeout = 20_000): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await read(); if (value) return value; await delay(50); }
  throw new Error(`Timed out: ${label}`);
}

// A request/response CDP socket, scoped to this test's page.
export async function connect(url: string) {
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

export async function openUi(t: TestContext, info: { port: number; token: string }) {
  const profile = mkdtempSync(join(tmpdir(), 'bn-chrome-'));
  const server = createServer((req, res) => {
    const path = resolve(root, 'desktop/dist', '.' + new URL(req.url!, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(join(root, 'desktop/dist') + '/') || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
    res.setHeader('Content-Type', mime[extname(path)] ?? 'text/plain'); res.end(readFileSync(path));
  });
  let cdp: Awaited<ReturnType<typeof connect>> | undefined;
  const chromePath = process.env.BIGNOSE_CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.ok(existsSync(chromePath), `Chrome missing: ${chromePath}`);
  const chrome = spawn(chromePath, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--remote-debugging-port=0', '--remote-debugging-address=127.0.0.1', '--disable-web-security', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: ['ignore', 'ignore', 'pipe'], detached: true });
  let diagnostic = '';
  chrome.stderr.on('data', chunk => { diagnostic = (diagnostic + String(chunk)).slice(-4000); });
  chrome.on('error', error => { diagnostic = error.message; });
  t.after(async () => {
    cdp?.close();
    if (chrome.exitCode === null && chrome.signalCode === null) {
      const closed = once(chrome, 'close');
      try { process.kill(-chrome.pid!, 'SIGTERM'); } catch { chrome.kill('SIGTERM'); }
      const timer = setTimeout(() => { try { process.kill(-chrome.pid!, 'SIGKILL'); } catch {} }, 3000);
      await closed; clearTimeout(timer);
    }
    server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  await until(() => {
    if (chrome.exitCode !== null || chrome.signalCode !== null || !chrome.pid) throw new Error(`Chrome stopped: ${diagnostic}`);
    return existsSync(join(profile, 'DevToolsActivePort'));
  }, 'Chrome DevTools');
  const debugPort = readFileSync(join(profile, 'DevToolsActivePort'), 'utf8').split('\n')[0];
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()) as { type: string; webSocketDebuggerUrl: string }[];
  cdp = await connect(pages.find(p => p.type === 'page')!.webSocketDebuggerUrl);
  const page = cdp;
  await page.call('Page.enable'); await page.call('Runtime.enable');
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__TAURI__ = {core:{invoke:async()=>(${JSON.stringify({ port: info.port, token: info.token, spawned: false })})}};` });
  await page.call('Page.navigate', { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/` });
  const wait = (expression: string, label = expression) => until(() => page.evaluate(expression), label);
  const click = async (label: string, scope = 'document') => {
    await wait(`Array.from((${scope})?.querySelectorAll('button,a') ?? []).some(b=>b.textContent===${JSON.stringify(label)} && !b.disabled)`);
    await page.evaluate(`Array.from(${scope}.querySelectorAll('button,a')).find(b=>b.textContent===${JSON.stringify(label)}).click()`);
  };
  const fill = (selector: string, value: string) => page.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  const field = (label: string, value: string, scope = 'document') => page.evaluate(`(()=>{const e=Array.from(${scope}.querySelectorAll('label')).find(l=>l.querySelector('.field-label')?.textContent===${JSON.stringify(label)}).querySelector('input,textarea,select');e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await wait(`document.querySelector('.nav-conn')?.textContent==='Connected'`);
  return { cdp: page, wait, click, fill, field };
}
