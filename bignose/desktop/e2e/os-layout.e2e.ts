import test from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../../core/src/app/daemon.ts';
import { configured, testHome } from '../../core/test/e2e/helpers.ts';
import { openUi } from './cdp.ts';

const ready = { phase: 'ready', url: 'http://127.0.0.1:3100' };
const osInfo = { node: process.execPath, erpDir: '/nonexistent/erp', mcpServer: '/nonexistent/erp/lib/mcp/erp-server.mjs' };

async function daemon(t: test.TestContext) {
  const home = testHome(t);
  // the ERP assistant is created on local Ollama; nothing here ever calls it
  configured(home, 'http://127.0.0.1:1/v1', c => { c.providers.push({ id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1' }); });
  const app = await startDaemon({ home }); t.after(() => app.close());
  return app;
}

test('settings scroll inside the window and the save bar stays reachable', { timeout: 120_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { viewport: { width: 1000, height: 480 }, hash: '#/settings/line' });
  const save = `document.querySelector('[aria-label="Settings"] form button[type=submit]')`;
  await ui.wait(save);
  // the bar shows only once something differs; change a field that sits inside the (closed) More options fold
  assert.equal(await ui.cdp.evaluate(`${save}.closest('.save-bar').hidden`), true, 'nothing changed, no bar');
  await ui.field('Public address', 'https://tunnel.example', `document.querySelector('[aria-label="Settings"]')`);
  await ui.wait(`!${save}.closest('.save-bar').hidden`);
  const geometry = await ui.cdp.evaluate(`(() => {
    const settings = document.querySelector('[aria-label="Settings"]'), page = document.scrollingElement, r = ${save}.getBoundingClientRect();
    return { shell: document.querySelector('.shell').getBoundingClientRect().height, vh: innerHeight, pageScroll: page.scrollHeight - page.clientHeight,
      paneScroll: settings.scrollHeight - settings.clientHeight, top: r.top, bottom: r.bottom };
  })()`);
  assert.ok(geometry.shell <= geometry.vh, `the shell fits the window: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.pageScroll, 0, 'the page itself does not scroll');
  assert.ok(geometry.paneScroll > 0, 'the settings pane is taller than the window, so it scrolls inside');
  assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.vh, `the bar sticks to the bottom of the window before any scrolling: ${JSON.stringify(geometry)}`);
  await ui.cdp.evaluate(`document.querySelector('[aria-label="Settings"]').scrollTop = 1e6`);
  const after = await ui.cdp.evaluate(`(() => { const r = ${save}.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; })()`);
  assert.ok(after.top >= 0 && after.bottom <= after.vh, `Save is on screen after scrolling the pane: ${JSON.stringify(after)}`);
  assert.deepEqual(ui.cdp.errors, []);
});

test('the panel fits a 420px panel and scrolls inside it', { timeout: 180_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { os: true, viewport: { width: 420, height: 640 }, commands: { os_status: ready, os_info: osInfo } });
  assert.ok(await ui.cdp.evaluate(`document.body.classList.contains('os-panel')`));
  // panel mode opens on the ERP assistant, set up through the local API
  await ui.wait(`document.querySelector('[aria-label="Chat agent"]')?.selectedOptions[0]?.textContent.includes('ERP assistant')`);
  assert.equal(await ui.cdp.evaluate(`document.querySelector('.model-link').textContent`), 'qwen3:4b');
  const fits = (label: string) => ui.cdp.evaluate(`(() => {
    const page = document.scrollingElement, nodes = ['.shell', '.main', '.chat', '.settings:not([hidden])'].map(s => document.querySelector(s)).filter(Boolean);
    return { label: ${JSON.stringify(label)}, overflowX: Math.max(page.scrollWidth - page.clientWidth, ...nodes.map(n => n.scrollWidth - n.clientWidth).map(d => d === -Infinity ? 0 : d)),
      pageScroll: page.scrollHeight - page.clientHeight };
  })()`);
  // the chat list is a strip under the top bar and scrolls sideways inside itself by design
  assert.equal(await ui.cdp.evaluate(`getComputedStyle(document.querySelector('.sessions')).overflowX`), 'auto');
  const routes = ['#/chat', '#/agents', ...['model', 'line', 'tools', 'memory', 'schedules'].map(s => `#/settings/${s}`)];
  for (const route of routes) {
    await ui.cdp.evaluate(`location.hash = ${JSON.stringify(route)}`);
    await ui.wait(`(document.querySelector('[aria-label="Settings"]:not([hidden]), [aria-label="Agents"]:not([hidden]), .chat:not([hidden])')?.textContent.length ?? 0) > 0`);
    const f = await fits(route);
    assert.equal(f.overflowX <= 0, true, `no sideways scroll at 420px on ${route}: ${JSON.stringify(f)}`);
    assert.equal(f.pageScroll, 0, `the page does not scroll on ${route}`);
  }
  // a long page scrolls inside the pane, not the page
  await ui.cdp.evaluate(`location.hash = '#/settings/line'`);
  await ui.wait(`document.querySelector('[aria-label="Settings"]:not([hidden]) form button[type=submit]')`);
  assert.ok(await ui.cdp.evaluate(`(() => { const s = document.querySelector('[aria-label="Settings"]'); return s.scrollHeight > s.clientHeight && getComputedStyle(s).overflowY === 'auto'; })()`));
  // the visible toggle button asks the Rust side to slide the panel
  assert.ok(await ui.cdp.evaluate(`(() => { const r = document.querySelector('.panel-toggle').getBoundingClientRect(); return r.width > 0 && r.right <= innerWidth && r.top >= 0; })()`));
  await ui.cdp.evaluate(`document.querySelector('.panel-toggle').click()`);
  assert.ok(await ui.cdp.evaluate(`window.__invokes.includes('os_toggle_panel')`));
  // closed, the panel is a 40px rail that is only the toggle button
  await ui.cdp.call('Emulation.setDeviceMetricsOverride', { width: 40, height: 640, deviceScaleFactor: 1, mobile: false });
  await ui.wait(`getComputedStyle(document.querySelector('.shell')).display === 'none'`);
  const rail = await ui.cdp.evaluate(`(() => { const r = document.querySelector('.panel-toggle').getBoundingClientRect(); const page = document.scrollingElement; return { w: r.width, h: r.height, x: page.scrollWidth - page.clientWidth }; })()`);
  assert.deepEqual(rail, { w: 40, h: 640, x: 0 });
  assert.deepEqual(ui.cdp.errors, []);
});

test('when the ERP server stops the panel shows why with Retry, and the collapsed rail keeps its toggle', { timeout: 120_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { os: true, viewport: { width: 420, height: 640 }, commands: { os_status: ready, os_info: osInfo } });
  await ui.wait(`document.querySelector('.shell') && document.querySelector('.panel-toggle')`);
  // the launcher leaves ready: boot() replaces the panel with the startup screen, which says why
  await ui.cdp.evaluate(`window.__answers.os_status = { phase: 'failed', title: 'The ERP server stopped', message: 'exit status 1' }`);
  await ui.wait(`document.querySelector('.splash')?.textContent.includes('The ERP server stopped')`);
  assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.panel-toggle').length`), 1, 'the toggle is not part of the replaced page');
  // collapsed to the 40px rail, the toggle is all there is, and it still asks the Rust side to slide the panel back
  await ui.cdp.call('Emulation.setDeviceMetricsOverride', { width: 40, height: 640, deviceScaleFactor: 1, mobile: false });
  await ui.wait(`getComputedStyle(document.querySelector('.splash')).display === 'none'`);
  const rail = await ui.cdp.evaluate(`(() => { const r = document.querySelector('.panel-toggle').getBoundingClientRect(); const page = document.scrollingElement; return { w: r.width, h: r.height, x: page.scrollWidth - page.clientWidth }; })()`);
  assert.deepEqual(rail, { w: 40, h: 640, x: 0 });
  await ui.cdp.evaluate(`window.__invokes.length = 0; document.querySelector('.panel-toggle').click()`);
  assert.ok(await ui.cdp.evaluate(`window.__invokes.includes('os_toggle_panel')`));
  // expanded again, Retry is there; once the server is back the panel returns with a single toggle
  await ui.cdp.call('Emulation.setDeviceMetricsOverride', { width: 420, height: 640, deviceScaleFactor: 1, mobile: false });
  await ui.click('Retry');
  await ui.cdp.evaluate(`window.__answers.os_status = ${JSON.stringify(ready)}`);
  await ui.wait(`document.querySelector('.shell') && !document.querySelector('.splash')`);
  assert.equal(await ui.cdp.evaluate(`document.querySelectorAll('.panel-toggle').length`), 1);
  assert.deepEqual(ui.cdp.errors, []);
});

test('the window shows Open Docker and Retry while Docker is stopped', { timeout: 60_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { os: true, shell: false, viewport: { width: 1180, height: 780 }, commands: { os_status: { phase: 'docker-stopped', installed: true } } });
  await ui.wait(`document.querySelector('.splash')?.textContent.includes('Docker is not running')`);
  assert.deepEqual(await ui.cdp.evaluate(`Array.from(document.querySelectorAll('.splash button')).map(b => b.textContent)`), ['Open Docker', 'Retry']);
  await ui.click('Open Docker'); await ui.click('Retry');
  await ui.wait(`window.__invokes.includes('os_open_docker') && window.__invokes.includes('os_retry')`);
  assert.deepEqual(ui.cdp.errors, []);
});
