import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { startDaemon } from '../../core/src/app/daemon.ts';
import { setSecret } from '../../core/src/config.ts';
import { configured, testHome } from '../../core/test/e2e/helpers.ts';
import { createApi } from '../src/api.ts';
import { openUi } from './cdp.ts';

test('desktop Connect and Test webhook reach a mock LINE API and a signed local webhook; status and health work', { timeout: 120_000 }, async t => {
  const home = testHome(t), calls: { path: string; body?: any; auth?: string }[] = [];
  let app: Awaited<ReturnType<typeof startDaemon>>;
  const mock = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const body = raw ? JSON.parse(raw) : undefined;
      calls.push({ path: req.url!, body, auth: req.headers.authorization });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/v2/bot/info') res.end(JSON.stringify({ displayName: 'Mock LINE bot', basicId: '@mock' }));
      else if (req.url === '/v2/bot/channel/webhook/endpoint') res.end('{}');
      else if (req.url === '/v2/bot/channel/webhook/test') {
        const event = JSON.stringify({ events: [] });
        const verified = await fetch(`http://127.0.0.1:${app.lineStatus().port}/line/webhook`, { method: 'POST', body: event,
          headers: { 'X-Line-Signature': createHmac('sha256', 'test-secret').update(event).digest('base64') } });
        await verified.text();
        res.end(JSON.stringify({ success: verified.ok, statusCode: verified.status, reason: 'OK', detail: 'Signed webhook verified' }));
      } else { res.writeHead(404); res.end('{}'); }
    } catch (e) { res.writeHead(500); res.end(JSON.stringify({ error: String(e) })); }
  });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { mock.close(() => resolve()); mock.closeAllConnections(); }));
  configured(home, undefined, c => { c.line.enabled = true; c.line.publicUrl = 'https://tunnel.example/base'; });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  app = await startDaemon({ home, lineOptions: { apiBase: `http://127.0.0.1:${(mock.address() as { port: number }).port}` } });
  t.after(() => app.close());
  const api = createApi({ port: app.port, token: app.token });
  const ui = await openUi(t, app);
  await ui.click('Messaging');
  await ui.wait(`document.querySelector('[aria-label="Settings"]').textContent.includes('Local listener running')`);
  await ui.wait(`document.querySelector('[aria-label="Settings"]').textContent.includes('Nobody is allowed yet')`);
  await ui.click('Connect');
  await ui.wait(`document.querySelector('.line-connect-result')?.textContent.includes('Webhook: ok')`);
  const connected = await ui.cdp.evaluate(`document.querySelector('.line-connect-result').textContent`);
  assert.match(connected, /Token: ok.*Mock LINE bot \(@mock\)/); assert.match(connected, /Webhook: ok.*https:\/\/tunnel.example\/base\/line\/webhook/);
  assert.deepEqual(calls.map(c => c.path), ['/v2/bot/info', '/v2/bot/channel/webhook/endpoint']);
  assert.deepEqual(calls[1]!.body, { endpoint: 'https://tunnel.example/base/line/webhook' });
  await ui.click('Test webhook');
  await ui.wait(`document.querySelector('.line-test-result')?.textContent.includes('Signed webhook verified')`);
  assert.match(await ui.cdp.evaluate(`document.querySelector('.line-test-result').textContent`), /Test: ok.*LINE status code: 200/);
  assert.equal(calls.at(-1)!.path, '/v2/bot/channel/webhook/test'); assert.ok(calls.every(c => c.auth === 'Bearer test-token'));
  const status = await api.lineStatus();
  assert.equal(status.running, true); assert.equal(status.warnings.length, 1);
  assert.equal(status.healthUrl, 'https://tunnel.example/base/line/webhook/health');
  const health = await fetch(`http://127.0.0.1:${status.port}/line/webhook/health`);
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { ok: true });
  assert.equal(app.runtime.store.listSessions().length, 0);
  // Connect refreshes status even if settings were changed outside this mounted form.
  await api.updateSettings(c => { c.line.allow.users = ['Uowner']; });
  await ui.click('Connect');
  await ui.wait(`document.querySelector('.line-connect-result').textContent.includes('Webhook: ok') && !document.querySelector('[aria-label="Settings"]').textContent.includes('Nobody is allowed yet')`);
  assert.deepEqual(ui.cdp.errors, []);
});
