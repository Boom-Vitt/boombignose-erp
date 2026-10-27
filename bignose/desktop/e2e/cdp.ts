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
// The page runs under the exact policy the Tauri window uses, so a stray inline style or remote asset shows up as a violation.
const csp: string = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')).app.security.csp;
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
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(`console.error: ${message.params.args.map((a: { value?: unknown; description?: string }) => a.value ?? a.description).join(' ')}`);
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

export interface UiOptions {
  /** Load the page as the BoomBigNose panel (window.__BIGNOSE_OS__). */
  os?: boolean;
  /** Fixed page size, e.g. a 420 px panel. */
  viewport?: { width: number; height: number };
  /** Answers for Tauri commands other than daemon_info; every command is recorded in window.__invokes, and window.__answers can change them later. */
  commands?: Record<string, unknown>;
  hash?: string;
  /** False when the page stops at the startup screen instead of the connected shell. */
  shell?: boolean;
}

export async function openUi(t: TestContext, info: { port: number; token: string }, options: UiOptions = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'bn-chrome-'));
  const server = createServer((req, res) => {
    const path = resolve(root, 'desktop/dist', '.' + new URL(req.url!, 'http://local').pathname.replace(/\/$/, '/index.html'));
    if (!path.startsWith(join(root, 'desktop/dist') + '/') || !existsSync(path)) { res.writeHead(404); res.end(); return; }
    const mime: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[extname(path)] ?? 'text/plain'); res.setHeader('Content-Security-Policy', csp); res.end(readFileSync(path));
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
  // Chrome can create DevToolsActivePort before it writes the port, so wait for a numeric first line.
  const debugPort = await until(() => {
    if (chrome.exitCode !== null || chrome.signalCode !== null || !chrome.pid) throw new Error(`Chrome stopped: ${diagnostic}`);
    const file = join(profile, 'DevToolsActivePort');
    const port = existsSync(file) ? readFileSync(file, 'utf8').split('\n')[0] : '';
    return /^\d+$/.test(port!) ? port : undefined;
  }, 'Chrome DevTools');
  const pages = await fetch(`http://127.0.0.1:${debugPort}/json/list`).then(r => r.json()) as { type: string; webSocketDebuggerUrl: string }[];
  cdp = await connect(pages.find(p => p.type === 'page')!.webSocketDebuggerUrl);
  const page = cdp;
  await page.call('Page.enable'); await page.call('Runtime.enable');
  const daemon = { port: info.port, token: info.token, spawned: false };
  await page.call('Page.addScriptToEvaluateOnNewDocument', { source: `window.__csp=[];document.addEventListener('securitypolicyviolation',e=>window.__csp.push(e.violatedDirective+' '+e.blockedURI),true);window.__invokes=[];const answers=window.__answers=${JSON.stringify(options.commands ?? {})};window.__TAURI__ = {core:{invoke:async(cmd)=>{window.__invokes.push(cmd);return cmd in answers?answers[cmd]:(${JSON.stringify(daemon)})}}};${options.os ? 'window.__BIGNOSE_OS__=true;' : ''}` });
  if (options.viewport) await page.call('Emulation.setDeviceMetricsOverride', { ...options.viewport, deviceScaleFactor: 1, mobile: false });
  await page.call('Page.navigate', { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/${options.hash ?? ''}` });
  const wait = (expression: string, label = expression) => until(() => page.evaluate(expression), label);
  // Each helper finds its target and acts in the same evaluate, and the bounded wait repeats only while the target is not there, so a re-render between two looks cannot leave a stale or null scope behind.
  const click = (label: string, scope = 'document') => wait(`(() => {
    const b = Array.from((${scope})?.querySelectorAll('button,a') ?? []).find(b => b.textContent === ${JSON.stringify(label)} && !b.disabled);
    if (!b) return false;
    b.click(); return true;
  })()`, `click ${label}`);
  const set = (found: string, value: string) => `(() => {
    const e = ${found};
    if (!e) return false;
    e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); return true;
  })()`;
  const fill = (selector: string, value: string) => wait(set(`document.querySelector(${JSON.stringify(selector)})`, value), `fill ${selector}`);
  const field = (label: string, value: string, scope = 'document') => wait(
    set(`Array.from((${scope})?.querySelectorAll('label') ?? []).find(l => l.querySelector('.field-label')?.textContent === ${JSON.stringify(label)})?.querySelector('input,textarea,select')`, value), `field ${label}`);
  if (options.shell !== false) await wait(`document.querySelector('.nav-conn')?.textContent==='Connected'`);
  return { cdp: page, wait, click, fill, field };
}
