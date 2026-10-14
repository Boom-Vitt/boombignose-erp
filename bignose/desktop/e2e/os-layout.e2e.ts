import test from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../../core/src/app/daemon.ts';
import { configured, testHome } from '../../core/test/e2e/helpers.ts';
import { openUi } from './cdp.ts';

const ready = { phase: 'ready', url: 'http://127.0.0.1:3100' };
const osInfo = { node: process.execPath, erpDir: '/nonexistent/erp', mcpServer: '/nonexistent/erp/lib/mcp/erp-server.mjs' };

async function daemon(t: test.TestContext) {
  const home = testHome(t);
  // the ERP assistant is created on openrouter, so the provider has to exist; nothing here ever calls it
  configured(home, 'http://127.0.0.1:1/v1', c => { c.providers.push({ id: 'openrouter', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }); });
  const app = await startDaemon({ home }); t.after(() => app.close());
  return app;
}

test('settings scroll inside the window and Save is reachable', { timeout: 120_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { viewport: { width: 1000, height: 480 }, hash: '#/settings/messaging' });
  await ui.wait(`document.querySelector('[aria-label="Settings"] form button[type=submit]')`);
  const geometry = await ui.cdp.evaluate(`(() => {
    const settings = document.querySelector('[aria-label="Settings"]'), save = document.querySelector('[aria-label="Settings"] form button[type=submit]');
    const page = document.scrollingElement;
    return { shell: document.querySelector('.shell').getBoundingClientRect().height, vh: innerHeight, pageScroll: page.scrollHeight - page.clientHeight,
      paneScroll: settings.scrollHeight - settings.clientHeight, saveBottomBefore: save.getBoundingClientRect().bottom };
  })()`);
  assert.ok(geometry.shell <= geometry.vh, `the shell fits the window: ${JSON.stringify(geometry)}`);
  assert.equal(geometry.pageScroll, 0, 'the page itself does not scroll');
  assert.ok(geometry.paneScroll > 0, 'the settings pane is taller than the window, so it scrolls inside');
  assert.ok(geometry.saveBottomBefore > geometry.vh, 'Save starts below the fold on this short window');
  await ui.cdp.evaluate(`document.querySelector('[aria-label="Settings"]').scrollTop = 1e6`);
  const save = await ui.cdp.evaluate(`(() => { const r = document.querySelector('[aria-label="Settings"] form button[type=submit]').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, vh: innerHeight }; })()`);
  assert.ok(save.top >= 0 && save.bottom <= save.vh, `Save is on screen after scrolling the pane: ${JSON.stringify(save)}`);
  assert.deepEqual(ui.cdp.errors, []);
});

test('the panel fits a 420px panel and scrolls inside it', { timeout: 180_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { os: true, viewport: { width: 420, height: 640 }, commands: { os_status: ready, os_info: osInfo } });
  assert.ok(await ui.cdp.evaluate(`document.body.classList.contains('os-panel')`));
  // panel mode opens on the ERP assistant, set up through the local API
  await ui.wait(`document.querySelector('[aria-label="Chat agent"]')?.selectedOptions[0]?.textContent.includes('ERP assistant')`);
  assert.equal(await ui.cdp.evaluate(`document.querySelector('[aria-label="Agent model"]').value`), 'google/gemini-4-argon');
  const fits = (label: string) => ui.cdp.evaluate(`(() => {
    const page = document.scrollingElement, nodes = ['.shell', '.main', '.chat', '.settings:not([hidden])'].map(s => document.querySelector(s)).filter(Boolean);
    return { label: ${JSON.stringify(label)}, overflowX: Math.max(page.scrollWidth - page.clientWidth, ...nodes.map(n => n.scrollWidth - n.clientWidth).map(d => d === -Infinity ? 0 : d)),
      pageScroll: page.scrollHeight - page.clientHeight };
  })()`);
  // the section links scroll sideways inside their own strip by design
  assert.equal(await ui.cdp.evaluate(`getComputedStyle(document.querySelector('.nav')).overflowX`), 'auto');
  const routes = ['#/chat', '#/agents', ...['general', 'providers', 'connectors', 'messaging', 'hooks', 'skills', 'memory', 'schedules'].map(s => `#/settings/${s}`)];
  for (const route of routes) {
    await ui.cdp.evaluate(`location.hash = ${JSON.stringify(route)}`);
    await ui.wait(`(document.querySelector('[aria-label="Settings"]:not([hidden]), [aria-label="Agents"]:not([hidden]), .chat:not([hidden])')?.textContent.length ?? 0) > 0`);
    const f = await fits(route);
    assert.equal(f.overflowX <= 0, true, `no sideways scroll at 420px on ${route}: ${JSON.stringify(f)}`);
    assert.equal(f.pageScroll, 0, `the page does not scroll on ${route}`);
  }
  // a long page scrolls inside the pane, not the page
  await ui.cdp.evaluate(`location.hash = '#/settings/messaging'`);
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

test('the window shows Open Docker and Retry while Docker is stopped', { timeout: 60_000 }, async t => {
  const app = await daemon(t);
  const ui = await openUi(t, app, { os: true, shell: false, viewport: { width: 1180, height: 780 }, commands: { os_status: { phase: 'docker-stopped', installed: true } } });
  await ui.wait(`document.querySelector('.splash')?.textContent.includes('Docker is not running')`);
  assert.deepEqual(await ui.cdp.evaluate(`Array.from(document.querySelectorAll('.splash button')).map(b => b.textContent)`), ['Open Docker', 'Retry']);
  await ui.click('Open Docker'); await ui.click('Retry');
  await ui.wait(`window.__invokes.includes('os_open_docker') && window.__invokes.includes('os_retry')`);
  assert.deepEqual(ui.cdp.errors, []);
});
