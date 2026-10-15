// The simple UI (design-spec §12), scoped to the chat routes and the BigNose OS panel. Later streams add their own routes.
// Each test has its own daemon with a temp home and a scripted mock model; nothing touches ~/.bignose or 127.0.0.1:47821.
// Set BIGNOSE_SHOTS=<dir> to also save chat-light.png and chat-dark.png (1280x800) for human review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startDaemon } from '../../core/src/app/daemon.ts';
import { configured, mockOpenai, testHome, toolCall } from '../../core/test/e2e/helpers.ts';
import { createApi } from '../src/api.ts';
import { openUi, until } from './cdp.ts';

type Ui = Awaited<ReturnType<typeof openUi>>;
const src = fileURLToPath(new URL('../src/', import.meta.url));
const SIZES = [{ width: 820, height: 540 }, { width: 1280, height: 800 }];
const ready = { phase: 'ready', url: 'http://127.0.0.1:3100' };
const osInfo = { node: process.execPath, erpDir: '/nonexistent/erp', mcpServer: '/nonexistent/erp/lib/mcp/erp-server.mjs' };
const LONG = '/very/long/unbroken/path/segment'.repeat(12);

const resize = (ui: Ui, size: { width: number; height: number }) => ui.cdp.call('Emulation.setDeviceMetricsOverride', { ...size, deviceScaleFactor: 1, mobile: false });
const scheme = (ui: Ui, value: 'light' | 'dark') => ui.cdp.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value }] });
const sourceFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? sourceFiles(join(dir, f)) : /\.(ts|html|css)$/.test(f) ? [join(dir, f)] : []));

async function shot(ui: Ui, name: string) {
  const dir = process.env.BIGNOSE_SHOTS;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, name), Buffer.from((await ui.cdp.call('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
}

/** [what is wider than the window] for the page and the parts that must not scroll sideways. */
const overflow = (ui: Ui, parts = '.shell, .main, .chat, .messages, .composer') => ui.cdp.evaluate(`(() => {
  const page = document.scrollingElement;
  return { page: page.scrollWidth - page.clientWidth, wide: [...document.querySelectorAll(${JSON.stringify(parts)})].filter(n => n.scrollWidth > n.clientWidth).map(n => n.className) };
})()`);

/** Visible elements painted in the accent colour that are not one of the main actions. */
const strayAccent = (ui: Ui) => ui.cdp.evaluate(`(() => {
  const hex = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  const accent = 'rgb(' + [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ') + ')';
  const main = '.btn.primary, .send:not(.stop), .switch:checked, .choice-tick, .dot';
  const visible = e => e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
  const painted = [...document.querySelectorAll('#app *')].filter(e => visible(e) && getComputedStyle(e).backgroundColor === accent);
  return { painted: painted.length, stray: painted.filter(e => !e.matches(main)).map(e => e.className) };
})()`);

async function chatDaemon(t: test.TestContext, answer: (req: any, call: number) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const home = testHome(t), work = join(home, 'work');
  mkdirSync(work);
  for (const f of ['a.txt', 'b.txt', 'c.txt']) writeFileSync(join(work, f), f);
  const mock = await mockOpenai(t, answer);
  configured(home, mock.baseUrl, (c) => { c.agent.workspace = work; });
  const app = await startDaemon({ home }); t.after(() => app.close());
  return { app, mock, work };
}

test('the simple chat UI', { timeout: 300_000 }, async (t) => {
  // The scripted model: look at the folder, ask to run a command (denied), write a file, run a second command, answer in Thai
  // with a very long path; the second message fails.
  const { app, work } = await chatDaemon(t, async (_req, call) => {
    if (call === 1) { await delay(800); return toolCall('list_files', { path: work }, 'c-list'); }
    if (call === 2) return toolCall('shell', { command: 'echo one' }, 'c-one');
    if (call === 3) return toolCall('write_file', { path: join(work, 'notes.md'), content: 'บันทึกจาก e2e\nsecond line' }, 'c-write');
    if (call === 4) return toolCall('shell', { command: 'echo two' }, 'c-two');
    if (call === 5) return { content: `## เสร็จแล้ว\nไฟล์ทั้งหมดอยู่ใน **${LONG}**\n\`\`\`bash\n${LONG}\n\`\`\`` };
    throw new Error('the model fell over');
  });
  const ui = await openUi(t, app, { viewport: SIZES[1]! });
  const text = (selector: string) => ui.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);

  await t.test('sidebar links are New chat, Agents and Settings', async () => {
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.nav .nav-link')].map(a => a.textContent.replace('⌘N', '').trim())`), ['New chat', 'Agents', 'Settings']);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.nav-conn').textContent`), 'Connected');
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.nav .nav-link')].map(a => a.getAttribute('aria-current'))`), ['page', 'false', 'false'], 'New chat is current while the chat is empty');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.agent-switch select').getAttribute('aria-label')`), 'Chat agent');
  });

  await t.test('the empty chat: header, composer, one send button, model link', async () => {
    assert.equal(await ui.cdp.evaluate(`!document.querySelector('.composer-note, .chat-model')`), true);
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.chat-head select, .chat-head input').length`), 0);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.send')].filter(b => b.getClientRects().length).map(b => b.textContent)`), ['Send']);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.model-link').getAttribute('href').endsWith('#/settings/model')`), true);
    assert.equal(await text('.model-link'), 'test-model');
    assert.match(await text('.empty'), /How can I help\?You're chatting with BigNose on test-model\. It asks before it runs commands or changes files\./);
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.empty .chip').length`), 3);
    await ui.cdp.evaluate(`document.querySelectorAll('.empty .chip')[2].click()`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('[aria-label="Message"]').value`), 'Plan my week');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.send').disabled`), false);
    await ui.fill('[aria-label="Message"]', '');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.send').disabled`), true, 'Send is disabled while the message is blank');
  });

  await t.test('a run: streaming bubble, plain tool row, the approval card focuses Deny and Esc denies, Allow once, receipts', async () => {
    await ui.fill('[aria-label="Message"]', 'ช่วยดูโฟลเดอร์งานแล้วลองรันคำสั่งให้หน่อย');
    await ui.click('Send');
    await ui.wait(`document.querySelector('.msg.assistant.streaming')`, 'the streaming bubble shows from run_start');
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.send')].filter(b => b.getClientRects().length).map(b => b.textContent)`), ['Stop']);
    await ui.wait(`document.querySelector('.tool .tool-status.done')`);
    assert.match(await text('.tool .tool-name'), /^Looked at 3 items in work$/);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.msg.assistant.streaming')`), null, 'the caret stops at the first tool');

    await ui.wait(`document.querySelector('.approval-actions')`);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.approval-actions .btn')].map(b => b.textContent)`), ['Deny', 'Allow once']);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Deny', 'the composer was empty, so Deny has focus');
    assert.match(await ui.cdp.evaluate(`getComputedStyle(document.querySelector('.approval-actions .btn'), '::after').content`), /Esc/);
    assert.equal(await text('.approval-title'), 'Run this command?');
    assert.equal(await text('.approval-cmd'), 'echo one');
    assert.equal(await ui.cdp.evaluate(`(() => { const c = document.querySelector('.approval'); return !/always allow/i.test(c.textContent) && !c.querySelector('.approval-icon'); })()`), true);
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.tool')].filter(r => r.hidden).length`), 1, 'the running row hides while the card is up');
    const accent = await strayAccent(ui);
    assert.ok(accent.painted >= 1, 'Allow once is the accent action'); assert.deepEqual(accent.stray, []);
    await shot(ui, 'chat-light.png');
    await scheme(ui, 'dark');
    assert.equal(await ui.cdp.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(20, 18, 22)');
    assert.deepEqual((await strayAccent(ui)).stray, []);
    await shot(ui, 'chat-dark.png');
    await scheme(ui, 'light');
    assert.equal(await ui.cdp.evaluate(`getComputedStyle(document.body).backgroundColor`), 'rgb(255, 255, 255)');

    // Esc anywhere in the page denies the newest pending card; Enter does not approve
    await ui.cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
    await ui.cdp.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
    await ui.wait(`document.querySelector('.approval.denied')?.textContent.startsWith('You denied:')`);
    assert.equal(await text('.approval.denied'), 'You denied: echo one');

    // a file write shows what it would write behind Show changes (the running row that holds the input is hidden meanwhile)
    await ui.wait(`document.querySelector('.approval:not(.denied):not(.allowed) .approval-changes')`);
    assert.equal(await text('.approval:not(.denied) .approval-title'), 'Change this file?');
    assert.equal(await text('.approval:not(.denied) .approval-cmd'), join(work, 'notes.md'));
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.approval-changes').open`), false);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.approval-change').checkVisibility()`), false, 'collapsed');
    await ui.cdp.evaluate(`document.querySelector('.approval-changes summary').click()`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.approval-change').checkVisibility()`), true);
    assert.equal(await text('.approval-change'), 'บันทึกจาก e2e\nsecond line');
    await shot(ui, 'chat-write-approval.png');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.approval-change').lang`), 'th');
    await ui.click('Allow once', `document.querySelector('.approval:not(.denied):not(.allowed)')`);
    await ui.wait(`document.querySelector('.approval.allowed')`);
    assert.equal(await text('.approval.allowed'), `You allowed once: ${join(work, 'notes.md')}`);
    await ui.wait(`[...document.querySelectorAll('.tool-name')].some(n => n.textContent === 'Wrote notes.md')`);
    assert.equal(readFileSync(join(work, 'notes.md'), 'utf8'), 'บันทึกจาก e2e\nsecond line');

    await ui.wait(`document.querySelector('.approval:not(.denied):not(.allowed)')`);
    assert.equal(await text('.approval:not(.denied):not(.allowed) .approval-cmd'), 'echo two');
    await ui.click('Allow once', `document.querySelector('.approval:not(.denied):not(.allowed)')`);
    await ui.wait(`[...document.querySelectorAll('.approval.allowed')].some(a => a.textContent === 'You allowed once: echo two')`);

    await ui.wait(`document.querySelector('.msg.assistant')?.textContent.includes('เสร็จแล้ว')`);
    await ui.wait(`[...document.querySelectorAll('.send')].filter(b => b.getClientRects().length).map(b => b.textContent)[0] === 'Send'`);
    await delay(700); // the reload after run_end must not take the receipts or the rows with it
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.approval')].map(a => a.className)`), ['approval denied', 'approval allowed', 'approval allowed']);
    assert.match(await ui.cdp.evaluate(`[...document.querySelectorAll('.tool-name')].map(n => n.textContent).join('|')`), /^Looked at 3 items in work\|Couldn't run echo one\|Wrote notes\.md\|Ran echo two$/);
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.tool[open]').length`), 0, 'a denial is the receipt line, it does not open the failed row');
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.msg.assistant h2').length`), 1, 'the markdown heading is a real heading');
    await shot(ui, 'chat-after-run.png');
  });

  await t.test('no horizontal overflow at 820x540 and 1280x800', async () => {
    for (const size of SIZES) {
      await resize(ui, size);
      await ui.wait(`innerWidth === ${size.width}`);
      assert.deepEqual(await overflow(ui), { page: 0, wide: [] }, `${size.width}x${size.height} with a long answer`);
    }
    await ui.cdp.evaluate(`document.querySelector('.nav .nav-link').click()`); // New chat
    await ui.wait(`document.querySelector('.empty')`);
    for (const size of SIZES) {
      await resize(ui, size);
      await ui.wait(`innerWidth === ${size.width}`);
      assert.deepEqual(await overflow(ui), { page: 0, wide: [] }, `${size.width}x${size.height} empty chat`);
    }
  });

  await t.test('the composer is inside the window at 820x540', async () => {
    await resize(ui, SIZES[0]!);
    await ui.wait(`innerHeight === 540`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.composer-box').getBoundingClientRect().bottom <= innerHeight`), true);
  });

  await t.test('a failed run is one error card that survives the reload', async () => {
    await resize(ui, SIZES[1]!);
    await ui.fill('[aria-label="Message"]', 'ลองอีกครั้ง');
    await ui.click('Send');
    await ui.wait(`document.querySelector('.alert[role=alert]')`);
    await delay(1000); // the session_updated reload that used to wipe the note
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.alert[role=alert]').length`), 1);
    assert.equal(await text('.alert-title'), "The model didn't answer");
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.alert-more').hidden`), true);
    await ui.click('Show details', `document.querySelector('.alert')`);
    assert.match(await text('.alert-more pre'), /Provider HTTP 500/);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.alert-actions .btn')].map(b => b.textContent)`), ['Try again', 'Hide details']);
    assert.deepEqual((await strayAccent(ui)).stray, []);
    await shot(ui, 'chat-error.png');
  });

  await t.test('Thai is tagged and clipped lines keep room', async () => {
    assert.equal(await ui.cdp.evaluate(`(() => {
      const walk = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
      const bare = [];
      for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[฀-๿]/.test(n.textContent) && !n.parentElement.closest('[lang="th"]')) bare.push(n.textContent);
      return bare;
    })().length`), 0);
    assert.ok(await ui.cdp.evaluate(`document.querySelectorAll('[lang="th"]').length`) > 2);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.session-title, .agent-mission, .chat-title, .tool-name, .save-bar-text')]
      .filter(e => e.getClientRects().length).filter(e => parseFloat(getComputedStyle(e).lineHeight) / parseFloat(getComputedStyle(e).fontSize) < 1.74).map(e => e.className)`), []);
  });

  await t.test('a chat picked from Agents brings the chat page forward', async () => {
    const title = await text('.session-title');
    await ui.cdp.evaluate(`location.hash = '#/agents'`);
    await ui.wait(`document.querySelector('.chat').hidden && !document.querySelector('[aria-label="Agents"]').hidden`);
    await ui.cdp.evaluate(`document.querySelector('.session').click()`);
    await ui.wait(`!document.querySelector('.chat').hidden && document.querySelector('[aria-label="Agents"]').hidden`, 'the chat page is shown');
    await ui.wait(`document.querySelector('.chat-title').textContent === ${JSON.stringify(title)} && document.querySelector('.msg.user')`, 'the picked chat is open');
    assert.equal(await ui.cdp.evaluate(`location.hash`), '#/chat');
  });

  await t.test('deleting a chat asks first: Cancel has focus, Esc keeps the chat, Delete removes it', async () => {
    const api = createApi({ port: app.port, token: app.token });
    const count = async () => (await api.listSessions()).sessions.length;
    const before = await count();
    const key = (type: string) => ui.cdp.call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await ui.cdp.evaluate(`document.querySelector('.session-item .icon-btn').click()`);
    await ui.wait(`document.querySelector('dialog[open]')`);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Cancel');
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('dialog[open] button')].map(b => b.textContent)`), ['Cancel', 'Delete']);
    await key('keyDown'); await key('keyUp');
    await ui.wait(`!document.querySelector('dialog[open]')`);
    assert.equal(await count(), before, 'Esc cancels without a DELETE');
    await ui.cdp.evaluate(`document.querySelector('.session-item .icon-btn').click()`);
    await ui.wait(`document.querySelector('dialog[open]')`);
    await ui.click('Delete', `document.querySelector('dialog[open]')`);
    await until(async () => (await count()) === before - 1, 'the chat is deleted');
    await ui.wait(`document.querySelector('.empty') && !document.querySelector('dialog')`);
  });

  await t.test('no CSP violations and no inline styles', async () => {
    assert.deepEqual(await ui.cdp.evaluate(`window.__csp`), []);
    const bad = sourceFiles(src).filter((f) => /style=|setAttribute\('style'|cssText/.test(readFileSync(f, 'utf8')));
    assert.deepEqual(bad, [], 'no inline style markup, setAttribute("style") or cssText in desktop/src');
  });

  await t.test('accent only on the main actions', async () => {
    await ui.cdp.evaluate(`location.hash = '#/chat'`);
    for (const mode of ['light', 'dark'] as const) {
      await scheme(ui, mode);
      const { stray } = await strayAccent(ui);
      assert.deepEqual(stray, [], mode);
    }
    await scheme(ui, 'light');
  });

  assert.deepEqual(ui.cdp.errors, []);
});

test('the OS panel at 420x640 has no horizontal overflow and keeps the composer in view', { timeout: 180_000 }, async (t) => {
  const home = testHome(t);
  // the ERP assistant is created on openrouter, so the provider has to exist; nothing answers on it, so a message fails
  configured(home, 'http://127.0.0.1:1/v1', (c) => { c.providers.push({ id: 'openrouter', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }); });
  const app = await startDaemon({ home }); t.after(() => app.close());
  const ui = await openUi(t, app, { os: true, viewport: { width: 420, height: 640 }, commands: { os_status: ready, os_info: osInfo } });
  await ui.wait(`document.querySelector('[aria-label="Chat agent"]')?.selectedOptions[0]?.textContent.includes('ERP assistant')`);
  const fits = async (label: string) => {
    assert.deepEqual(await overflow(ui, '.shell, .main, .chat, .messages, .composer, .nav'), { page: 0, wide: [] }, label);
    const box = await ui.cdp.evaluate(`(() => { const r = document.querySelector('.composer-box').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, width: r.width, vh: innerHeight }; })()`);
    assert.ok(box.width > 0 && box.top >= 0 && box.bottom <= box.vh, `${label}: the composer is in view ${JSON.stringify(box)}`);
  };
  await fits('empty panel');
  assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.nav .nav-link')].map(a => a.textContent.replace('⌘N', '').trim())`), ['New chat', 'Agents', 'Settings']);
  assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.nav .nav-link')].every(a => a.getBoundingClientRect().width >= 28 && a.getBoundingClientRect().right <= innerWidth)`), true, 'the links stay reachable as icons');
  assert.equal(await ui.cdp.evaluate(`document.querySelector('.panel-toggle').getBoundingClientRect().right <= innerWidth`), true);
  await ui.fill('[aria-label="Message"]', 'สวัสดี'.repeat(30) + ' ' + LONG);
  await ui.click('Send');
  await ui.wait(`document.querySelector('.alert[role=alert]')`);
  await fits('panel with an error card');
  assert.equal(await ui.cdp.evaluate(`document.querySelector('.alert').getBoundingClientRect().right <= innerWidth`), true);
  await shot(ui, 'panel-error.png');
  for (const route of ['#/agents', '#/settings/general', '#/chat']) {
    await ui.cdp.evaluate(`location.hash = ${JSON.stringify(route)}`);
    await ui.wait(`(document.querySelector('[aria-label="Settings"]:not([hidden]), [aria-label="Agents"]:not([hidden]), .chat:not([hidden])')?.textContent.length ?? 0) > 0`);
    assert.deepEqual(await overflow(ui, '.shell, .main, .nav'), { page: 0, wide: [] }, route);
  }
  // the launcher is watched after Ready: when the ERP server exits, the panel says so with Retry, and comes back once it is up again
  await ui.cdp.evaluate(`window.__answers.os_status = { phase: 'failed', title: 'The ERP server stopped', message: 'exit status 1' }`);
  await ui.wait(`document.querySelector('.splash')?.textContent.includes('The ERP server stopped')`, 'the stopped server is shown');
  assert.equal(await ui.cdp.evaluate(`document.querySelector('.splash').textContent.includes('exit status 1')`), true);
  assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.splash button')].map(b => b.textContent)`), ['Retry']);
  await ui.cdp.evaluate(`window.__answers.os_status = ${JSON.stringify(ready)}`);
  await ui.click('Retry');
  await ui.wait(`window.__invokes.includes('os_retry') && document.querySelector('.nav-conn')?.textContent === 'Connected'`, 'the shell is back after Retry');
  assert.deepEqual(await ui.cdp.evaluate(`window.__csp`), []);
  assert.deepEqual(ui.cdp.errors, []);
});

test('the agents pages', { timeout: 300_000 }, async (t) => {
  // Own daemon and temp home. The default agent has the bot icon and blank instructions; the others are made through the API.
  const home = testHome(t);
  configured(home);
  const app = await startDaemon({ home }); t.after(() => app.close());
  const api = createApi({ port: app.port, token: app.token });
  const base = { provider: 'mock', model: 'test-model' };
  const bot = (await api.listAgents()).agents[0]!;
  const shop = await api.createAgent({ ...base, name: 'ผู้ช่วยแอดมินร้าน', icon: '🛍️', instructions: 'Answers shop questions.\nSecond line.' });
  const clipped = 'Write captions and short scripts in the BoomBigNose voice: short, dry, with the hook in the first second.';
  const writer = await api.createAgent({ ...base, name: 'Writer', icon: '✍️', instructions: clipped });
  await api.addSchedule({ cron: '0 9 * * 1-5', prompt: 'Morning summary', delivery: { kind: 'desktop' }, agentId: shop.id });
  const ui = await openUi(t, app, { viewport: SIZES[1]!, hash: '#/agents' });
  const row = (id: string) => `document.querySelector('[data-agent-id="${id}"]')`;
  const text = (selector: string) => ui.cdp.evaluate(`document.querySelector(${JSON.stringify(selector)})?.textContent`);
  const press = async (key: string, code: number) => { for (const type of ['keyDown', 'keyUp']) await ui.cdp.call('Input.dispatchKeyEvent', { type, key, code: key, windowsVirtualKeyCode: code }); };
  const open = (id: string) => ui.cdp.evaluate(`${row(id)}.querySelector('[aria-haspopup=menu]').click()`);
  const rowsReady = (n: number) => ui.wait(`document.querySelectorAll('.agent-row').length === ${n}`, `${n} agent rows`);
  const go = async (hash: string) => { await ui.cdp.evaluate(`location.hash = ${JSON.stringify(hash)}`); };
  const accent = () => ui.cdp.evaluate(`getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()`);
  /** True once the page for `hash` is showing (the form's h1 names it, so a form from the last route cannot count). */
  const arrived = (hash: string) => hash === '#/agents' ? `location.hash === '#/agents' && document.querySelectorAll('.agent-row').length === 4`
    : hash === '#/agents/new' ? `document.querySelector('.page-head h1')?.textContent === 'New agent' && document.querySelector('.agent-form')`
      : `document.querySelector('.page-head h1')?.textContent.startsWith('Edit') && document.querySelector('.agent-form')`;
  await rowsReady(3);

  await t.test('the roster is one card of rows: avatar, name and what the agent is for', async () => {
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.agent-card').length`), 0);
    assert.equal(await ui.cdp.evaluate(`(() => { const rows = [...document.querySelectorAll('.agent-row')]; const parents = new Set(rows.map(r => r.parentElement)); return parents.size === 1 && [...parents][0].classList.contains('card') && rows.every(r => r.querySelector('.avatar') && r.querySelector('.agent-name') && r.querySelector('.agent-mission')); })()`), true);
    assert.equal(await text('.page-head h1'), 'Agents');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.page-head .btn.primary').textContent`), 'New agent');
    assert.equal(await text(`[data-agent-id="${bot.id}"] .agent-mission`), 'General assistant', 'blank instructions');
    assert.equal(await text(`[data-agent-id="${shop.id}"] .agent-mission`), 'Answers shop questions.', 'the first line');
    const long = await text(`[data-agent-id="${writer.id}"] .agent-mission`);
    assert.equal(long, `${clipped.slice(0, 79)}…`, 'a long first line is cut at 80 characters');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('[data-agent-id="${bot.id}"] .avatar.bot svg use').getAttribute('href')`), '#bot', 'the default icon is the headphone bot');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('[data-agent-id="${shop.id}"] .avatar').classList.contains('bot')`), false);
    assert.equal(await text(`[data-agent-id="${shop.id}"] .avatar`), '🛍️');
    assert.equal(await text(`[data-agent-id="${shop.id}"] .agent-meta`), 'test-model · 1 schedule');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('[data-agent-id="${shop.id}"] .agent-meta a').getAttribute('href')`), `#/settings/schedules?agent=${shop.id}`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.nav-link[href="#/agents"]').getAttribute('aria-current')`), 'page');
    await shot(ui, 'agents-light.png');
    await scheme(ui, 'dark'); await shot(ui, 'agents-dark.png'); await scheme(ui, 'light');
  });

  await t.test('an agent row shows Chat only on hover or focus', async () => {
    const chat = (id: string) => ui.cdp.evaluate(`getComputedStyle(${row(id)}.querySelector('.agent-chat')).opacity`);
    await ui.wait(`getComputedStyle(${row(bot.id)}.querySelector('.agent-chat')).opacity === '0'`, 'idle rows hide Chat');
    assert.equal(await chat(shop.id), '0');
    assert.equal(await ui.cdp.evaluate(`(() => { const b = ${row(shop.id)}.querySelector('.agent-chat'); return b.tabIndex === 0 && b.getClientRects().length > 0; })()`), true, 'hidden by opacity only, so the keyboard still reaches it');
    await ui.cdp.evaluate(`${row(shop.id)}.querySelector('[aria-haspopup=menu]').focus()`);
    await ui.wait(`getComputedStyle(${row(shop.id)}.querySelector('.agent-chat')).opacity === '1'`, 'focus shows Chat');
    assert.equal(await chat(bot.id), '0', 'only the row with focus');
    await ui.cdp.evaluate(`document.activeElement.blur()`);
    await ui.wait(`getComputedStyle(${row(shop.id)}.querySelector('.agent-chat')).opacity === '0'`);
    const at = await ui.cdp.evaluate(`(() => { const r = ${row(writer.id)}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await ui.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...at });
    await ui.wait(`getComputedStyle(${row(writer.id)}.querySelector('.agent-chat')).opacity === '1'`, 'hover shows Chat');
    await ui.cdp.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 5, y: 5 });
    await ui.wait(`getComputedStyle(${row(writer.id)}.querySelector('.agent-chat')).opacity === '0'`);
  });

  await t.test('the ⋯ menu: neutral highlight, no Use for LINE, arrows, Esc, Tab and a press outside close it', async () => {
    await open(shop.id);
    assert.equal(await ui.cdp.evaluate(`${row(shop.id)}.querySelector('[aria-haspopup=menu]').getAttribute('aria-expanded')`), 'true');
    assert.deepEqual(await ui.cdp.evaluate(`[...${row(shop.id)}.querySelectorAll('.menu-item')].map(b => b.textContent)`), ['Edit…', 'Duplicate', 'Delete…']);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Edit…', 'the first item has focus');
    const hex = await accent();
    const rgb = `rgb(${[1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    assert.notEqual(await ui.cdp.evaluate(`getComputedStyle(document.activeElement).backgroundColor`), rgb, 'the highlight is neutral, not the accent');
    assert.equal(await ui.cdp.evaluate(`/use for line/i.test(document.querySelector('.agent-row').closest('section').textContent)`), false);
    await ui.wait(`getComputedStyle(${row(shop.id)}.querySelector('.agent-chat')).opacity === '1'`, 'Chat stays while the menu is open');
    await press('ArrowDown', 40);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Duplicate');
    await press('ArrowUp', 38); await press('ArrowUp', 38);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Delete…', 'it wraps');
    await press('Escape', 27);
    assert.equal(await ui.cdp.evaluate(`${row(shop.id)}.querySelector('.menu').hidden`), true);
    assert.equal(await ui.cdp.evaluate(`document.activeElement === ${row(shop.id)}.querySelector('[aria-haspopup=menu]')`), true, 'Esc gives focus back to ⋯');
    await press('ArrowDown', 40);
    assert.equal(await ui.cdp.evaluate(`${row(shop.id)}.querySelector('.menu').hidden`), false, 'ArrowDown on ⋯ opens it');
    await press('Tab', 9);
    assert.equal(await ui.cdp.evaluate(`${row(shop.id)}.querySelector('.menu').hidden`), true, 'Tab closes it');
    await open(shop.id);
    const away = await ui.cdp.evaluate(`(() => { const r = document.querySelector('.page-head h1').getBoundingClientRect(); return { x: r.left + 4, y: r.top + 4 }; })()`);
    for (const type of ['mousePressed', 'mouseReleased']) await ui.cdp.call('Input.dispatchMouseEvent', { type, ...away, button: 'left', clickCount: 1 });
    assert.equal(await ui.cdp.evaluate(`${row(shop.id)}.querySelector('.menu').hidden`), true, 'a press elsewhere closes it');
    await open(shop.id); await open(writer.id);
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.menu:not([hidden])').length`), 1, 'one menu at a time');
    await shot(ui, 'agents-menu-light.png');
    await press('Escape', 27);
  });

  await t.test('the LINE badge shows only while LINE is on, on the agent that answers', async () => {
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.agent-row .badge.ok').length`), 0, 'LINE is off');
    await api.updateSettings((c) => { c.line.enabled = true; c.line.agentId = shop.id; });
    await go('#/chat'); await go('#/agents'); await rowsReady(3);
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.agent-row .badge.ok').length`), 1);
    assert.equal(await text(`[data-agent-id="${shop.id}"] .badge.ok`), 'Answers LINE');
  });

  await t.test('the agent form is its own page: Agents back link, a card of rows, More options, a save bar', async () => {
    await ui.click('New agent');
    await ui.wait(`document.querySelector('.agent-form')`);
    assert.equal(await ui.cdp.evaluate(`location.hash`), '#/agents/new');
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.agent-row').length`), 0, 'the roster is not on this page');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.nav-link[href="#/agents"]').getAttribute('aria-current')`), 'page');
    assert.equal(await text('a.back'), 'Agents'); assert.equal(await ui.cdp.evaluate(`document.querySelector('a.back').getAttribute('href')`), '#/agents');
    assert.equal(await text('.page-head h1'), 'New agent');
    const labels = `[...document.querySelectorAll('.agent-form .card > .field:not([hidden]) .field-label')].map(l => l.textContent)`;
    assert.deepEqual(await ui.cdp.evaluate(labels), ['Name', 'Icon', 'Instructions', 'Model']);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.agent-form .card select').selectedOptions[0].textContent`), 'Same as Settings (test-model)');
    assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.agent-form details.disclosure').length`), 1);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.agent-form details').open`), false, 'expert fields are folded');
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.group-title')].some(g => /advanced/i.test(g.textContent))`), false);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.agent-form .avatar-field .avatar').classList.contains('bot')`), true, 'a blank icon previews the bot');
    await ui.field('Icon', '🔎', `document.querySelector('.agent-form')`);
    assert.equal(await text('.agent-form .avatar-field .avatar'), '🔎');
    await ui.field('Icon', '', `document.querySelector('.agent-form')`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.agent-form .avatar-field .avatar').classList.contains('bot')`), true);
    assert.equal(await text('.save-bar-text'), 'New agent');
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.save-bar .btn')].map(b => b.textContent)`), ['Cancel', 'Create agent']);
    // Other… brings in the provider and the typed name
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form .field')].filter(f => ['Provider', 'Model name'].includes(f.querySelector('.field-label').textContent)).every(f => f.getClientRects().length === 0)`), true);
    await ui.cdp.evaluate(`(() => { const s = [...document.querySelectorAll('.agent-form .field')].find(f => f.querySelector('.field-label').textContent === 'Model').querySelector('select'); s.value = 'other'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form .field')].filter(f => ['Provider', 'Model name'].includes(f.querySelector('.field-label').textContent)).every(f => f.getClientRects().length > 0)`), true);
    await ui.cdp.evaluate(`(() => { const s = [...document.querySelectorAll('.agent-form .field')].find(f => f.querySelector('.field-label').textContent === 'Model').querySelector('select'); s.value = 'same'; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    // More options: what it may do, connectors and skills, longest answer
    await ui.cdp.evaluate(`document.querySelector('.agent-form details').open = true`);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form details > div > .row > .row-text')].map(r => r.firstChild.textContent)`), ['What it may do', 'Connectors and skills']);
    assert.equal(await text('.agent-form details .field .field-label'), 'Longest answer');
    await ui.click('Change…', `document.querySelector('.agent-form')`);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form .seg')].map(s => s.getAttribute('aria-label'))`), ['Read files', 'Change files', 'Run commands', 'Open web pages']);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelector('.agent-form .seg').querySelectorAll('button')].map(b => b.textContent)`), ['Allow', 'Ask', 'Never']);
    await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form .seg')][2].querySelectorAll('button')[2].click()`);
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-form .seg')][2].querySelectorAll('button')[2].getAttribute('aria-pressed')`), 'true');
    await shot(ui, 'agent-new-light.png');
    // create it
    await ui.field('Name', 'Temp', `document.querySelector('.agent-form')`);
    await ui.click('Create agent', `document.querySelector('.agent-form')`);
    const temp = await until(async () => (await api.listAgents()).agents.find((a) => a.name === 'Temp'), 'the new agent is saved');
    assert.equal(temp.icon, '🤖'); assert.equal(temp.provider, 'mock'); assert.equal(temp.model, 'test-model'); assert.deepEqual(temp.permissions, { shell: 'deny' });
    await ui.wait(`location.hash === '#/agents' && document.querySelectorAll('.agent-row').length === 4`, 'back on the roster');
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.toast')].some(x => x.textContent === 'Agent saved')`), true);

    // edit it: the bar appears only when something differs, names it, and Discard puts it back
    await open(temp.id); await ui.click('Edit…', row(temp.id));
    await ui.wait(`location.hash === '#/agents/${temp.id}' && document.querySelector('.agent-form')`);
    assert.equal(await text('.page-head h1'), 'Edit Temp');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.save-bar').hidden`), true);
    await ui.field('Instructions', 'Checks the stock list.', `document.querySelector('.agent-form')`);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.save-bar').hidden`), false);
    assert.equal(await text('.save-bar-text'), 'Instructions changed');
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.save-bar .btn')].map(b => b.textContent)`), ['Discard', 'Save']);
    await ui.click('Discard', `document.querySelector('.save-bar')`);
    await ui.wait(`document.querySelector('.save-bar')?.hidden === true && document.querySelector('.agent-form textarea').value === ''`, 'Discard puts the form back');
    await ui.field('Instructions', 'Checks the stock list.', `document.querySelector('.agent-form')`);
    await shot(ui, 'agent-edit-light.png');
    await ui.click('Save', `document.querySelector('.save-bar')`);
    await until(async () => (await api.getAgent(temp.id)).instructions === 'Checks the stock list.', 'the edit is saved');
    await ui.wait(`location.hash === '#/agents'`);

    // an agent that is gone
    await go('#/agents/ag_nope');
    await ui.wait(`document.querySelector('.notice.error')?.textContent.includes('That agent no longer exists.')`);
    await ui.click('Agents', `document.querySelector('a.back').parentElement`);
    await ui.wait(`location.hash === '#/agents' && document.querySelectorAll('.agent-row').length === 4`);
  });

  await t.test('Chat on a row opens that agent in the chat', async () => {
    await ui.click('Chat', row(writer.id));
    await ui.wait(`location.hash === '#/chat' && document.querySelector('[aria-label="Chat agent"]').value === ${JSON.stringify(writer.id)}`);
    await go('#/agents'); await rowsReady(4);
  });

  await t.test('no sideways scroll and no stray accent on the agents routes, light and dark, at 820x540 and 1280x800', async () => {
    const parts = '.shell, .main, .settings, .card, .agent-row, .save-bar';
    for (const hash of ['#/agents', '#/agents/new', `#/agents/${shop.id}`]) {
      await go(hash);
      await ui.wait(arrived(hash));
      if (hash.endsWith(shop.id)) await ui.cdp.evaluate(`document.querySelector('.agent-form details').open = true`);
      for (const size of SIZES) {
        await resize(ui, size); await ui.wait(`innerWidth === ${size.width}`);
        assert.deepEqual(await overflow(ui, parts), { page: 0, wide: [] }, `${hash} at ${size.width}x${size.height}`);
      }
      for (const mode of ['light', 'dark'] as const) {
        await scheme(ui, mode);
        assert.deepEqual((await strayAccent(ui)).stray, [], `${hash} ${mode}`);
      }
      await scheme(ui, 'light');
    }
    await shot(ui, 'agent-edit-thai-light.png');
    await resize(ui, SIZES[1]!); await ui.wait(`innerWidth === ${SIZES[1]!.width}`);
  });

  await t.test('Thai is tagged on the agents pages and clipped lines keep room', async () => {
    for (const hash of ['#/agents', `#/agents/${shop.id}`]) {
      await go(hash);
      await ui.wait(arrived(hash));
      assert.deepEqual(await ui.cdp.evaluate(`(() => {
        const walk = document.createTreeWalker(document.getElementById('app'), NodeFilter.SHOW_TEXT);
        const bare = [];
        for (let n = walk.nextNode(); n; n = walk.nextNode()) if (/[฀-๿]/.test(n.textContent) && !n.parentElement.closest('[lang="th"]')) bare.push(n.textContent);
        return bare;
      })()`), [], hash);
    }
    assert.equal(await text('.page-head h1'), 'Edit ผู้ช่วยแอดมินร้าน');
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.page-head h1').lang`), 'th');
    await go('#/agents'); await rowsReady(4);
    assert.deepEqual(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-mission, .save-bar-text')]
      .filter(e => e.getClientRects().length).filter(e => parseFloat(getComputedStyle(e).lineHeight) / parseFloat(getComputedStyle(e).fontSize) < 1.74).map(e => e.className)`), []);
  });

  await t.test('Delete… asks first: Cancel has focus, Esc keeps the agent, Delete removes it and says what goes with it', async () => {
    const count = async () => (await api.listAgents()).agents.length;
    const before = await count();
    const key = (type: string) => ui.cdp.call('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await open(shop.id); await ui.click('Delete…', row(shop.id));
    await ui.wait(`document.querySelector('dialog[open]')`);
    assert.equal(await ui.cdp.evaluate(`document.activeElement.textContent`), 'Cancel');
    assert.equal(await text('dialog[open] h2'), 'Delete ผู้ช่วยแอดมินร้าน?');
    const other = (await api.listAgents()).agents.find((a) => a.id !== shop.id)!.name;
    assert.equal(await text('dialog[open] p'), `Its chats, its notes and its 1 schedule are deleted too. LINE will be answered by ${other}.`);
    await key('keyDown'); await key('keyUp');
    await ui.wait(`!document.querySelector('dialog[open]')`);
    assert.equal(await count(), before, 'Esc deletes nothing');
    await open(shop.id); await ui.click('Delete…', row(shop.id));
    await ui.wait(`document.querySelector('dialog[open]')`);
    await ui.click('Delete', `document.querySelector('dialog[open]')`);
    await until(async () => (await count()) === before - 1, 'the agent is deleted');
    await rowsReady(3);
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.agent-row .badge.ok')].map(b => b.closest('.agent-row').querySelector('.agent-name span').textContent).join()`), other, 'LINE moved to the agent the dialog named');
  });

  await t.test('the last agent cannot be deleted', async () => {
    for (const a of (await api.listAgents()).agents.slice(1)) await api.deleteAgent(a.id);
    await go('#/chat'); await go('#/agents'); await rowsReady(1);
    await open(bot.id);
    assert.equal(await ui.cdp.evaluate(`[...document.querySelectorAll('.menu-item')].find(b => b.textContent === 'Delete…').disabled`), true);
    assert.equal(await ui.cdp.evaluate(`document.querySelector('.menu-note').textContent`), 'BigNose needs at least one agent.');
  });

  await t.test('no CSP violations and no console errors', async () => {
    assert.deepEqual(await ui.cdp.evaluate(`window.__csp`), []);
    assert.deepEqual(ui.cdp.errors, []);
  });
});
