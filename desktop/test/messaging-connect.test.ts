import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountMessaging } from '../src/settings/messaging.ts';
import { config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { LineStatus } from '../src/types.ts';

const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const control = (node: TestNode, label: string) => {
  const field = node.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label)!;
  assert.ok(field, `Missing field: ${label}`);
  return field.querySelector('input')!;
};
const status: LineStatus = {
  enabled: true, running: true, port: 47822, tokenSet: true, secretSet: true,
  publicUrl: 'https://tunnel.example', webhookUrl: 'https://tunnel.example/line/webhook',
  healthUrl: 'https://tunnel.example/line/webhook/health', warnings: ['Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.'],
};

function harness(connect: () => Response | Promise<Response> = () => json({ ok: true, steps: [] }),
  webhookTest: () => Response | Promise<Response> = () => json({ ok: true, running: true, statusCode: 200, detail: 'OK' }),
  lineStatus = status, slowResponseMs = 45000) {
  let stored = structuredClone(config);
  stored.line = { ...stored.line, enabled: lineStatus.enabled, port: lineStatus.port, publicUrl: lineStatus.publicUrl, slowResponseMs };
  const calls: { path: string; method: string; body: any; headers: Record<string, string> }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body, headers: init?.headers as Record<string, string> });
    if (path === '/api/settings') { if (method === 'PUT') stored = body.config; return json({ config: stored, secrets: {} }); }
    if (path === '/api/secrets') return json({ name: body.name, masked: '••••' });
    if (path === '/api/line/status') return json(lineStatus);
    if (path === '/api/line/connect') return connect();
    if (path === '/api/line/test') return webhookTest();
    assert.fail(`Unexpected request: ${method} ${path}`);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, calls, config: () => stored };
}

async function mount(h: ReturnType<typeof harness>) {
  mountMessaging(h.pane as unknown as HTMLElement, h.api); await flush();
  return h.pane.querySelector('form')!;
}

test('status shows local listener state, health hint, warnings and a copyable webhook URL', async t => {
  t.after(installDom());
  for (const running of [true, false]) {
    const h = harness(undefined, undefined, { ...status, running, enabled: running }); await mount(h);
    assert.ok(h.pane.querySelectorAll('.badge').some(b => b.textContent === (running ? 'Enabled' : 'Disabled')));
    assert.ok(h.pane.querySelectorAll('.badge').some(b => b.textContent === `Local listener ${running ? 'running' : 'stopped'}`));
    assert.ok(h.pane.textContent.includes('Open https://tunnel.example/line/webhook/health in a browser to check your tunnel.'));
    assert.ok(h.pane.textContent.includes(status.warnings[0]!));
    assert.equal(control(h.pane, 'Webhook URL').value, 'https://tunnel.example/line/webhook');
    assert.ok(button(h.pane, 'Copy'));
    assert.match(h.pane.textContent, /Save does not prove.*token.*tunnel.*Connect.*Test webhook/);
  }
});

test('Connect displays both successful steps and bot identity using the authenticated POST route', async t => {
  t.after(installDom());
  const h = harness(() => json({ ok: true, bot: { displayName: 'My bot <script>', basicId: '@my-bot' }, webhookUrl: status.webhookUrl,
    steps: [{ name: 'token', ok: true, detail: 'Connected' }, { name: 'webhook', ok: true, detail: 'Webhook set' }] }));
  await mount(h); button(h.pane, 'Connect').fire('click'); await flush();
  const result = h.pane.querySelector('.line-connect-result')!;
  assert.match(result.textContent, /token: ok.*Connected/);
  assert.match(result.textContent, /webhook: ok.*Webhook set/);
  assert.ok(result.textContent.includes('My bot <script> (@my-bot)'));
  assert.equal(result.querySelector('script'), null);
  const call = h.calls.find(c => c.path === '/api/line/connect')!;
  assert.equal(call.method, 'POST'); assert.deepEqual(call.body, {});
  assert.equal(call.headers.Authorization, 'Bearer test-token');
});

for (const tokenOk of [true, false]) test(`Connect shows failed webhook and ${tokenOk ? 'successful' : 'failed'} token steps`, async t => {
  t.after(installDom());
  const h = harness(() => json({ ok: false, ...(tokenOk ? { bot: { displayName: 'Bot', basicId: '@bot' } } : {}), steps: [
    { name: 'token', ok: tokenOk, detail: tokenOk ? 'Connected' : 'Save the channel access token first.' },
    { name: 'webhook', ok: false, detail: tokenOk ? 'Set a public HTTPS URL first.' : 'Fix the token first.' },
  ] }));
  await mount(h); button(h.pane, 'Connect').fire('click'); await flush();
  const text = h.pane.querySelector('.line-connect-result')!.textContent;
  assert.ok(text.includes(`token: ${tokenOk ? 'ok' : 'failed'}`));
  assert.ok(text.includes('webhook: failed'));
  assert.ok(text.includes(tokenOk ? 'Set a public HTTPS URL first.' : 'Fix the token first.'));
  if (tokenOk) assert.ok(text.includes('Bot (@bot)'));
  else assert.ok(text.includes('Save the channel access token first.'));
});

for (const ok of [true, false]) test(`Test webhook displays LINE's ${ok ? 'success' : 'failure'} code and detail`, async t => {
  t.after(installDom());
  const h = harness(undefined, () => json({ ok, running: true, statusCode: ok ? 200 : 401, reason: 'Reason', detail: '<script>Detail</script>' }));
  await mount(h); button(h.pane, 'Test webhook').fire('click'); await flush();
  const result = h.pane.querySelector('.line-test-result')!;
  assert.ok(result.textContent.includes(`LINE status code: ${ok ? 200 : 401}`));
  assert.ok(result.textContent.includes('<script>Detail</script>'));
  assert.equal(result.querySelector('script'), null);
  const call = h.calls.find(c => c.path === '/api/line/test')!;
  assert.equal(call.method, 'POST'); assert.deepEqual(call.body, {});
  assert.equal(call.headers.Authorization, 'Bearer test-token');
});

test('Test webhook shows the actionable listener-off response without inventing a status code', async t => {
  t.after(installDom());
  const detail = 'The LINE listener is not running. Turn LINE on, save, then test again.';
  const h = harness(undefined, () => json({ ok: false, running: false, detail }));
  await mount(h); button(h.pane, 'Test webhook').fire('click'); await flush();
  const text = h.pane.querySelector('.line-test-result')!.textContent;
  assert.ok(text.includes(detail)); assert.ok(!text.includes('status code'));
});

for (const label of ['Connect', 'Test webhook']) test(`${label} is disabled while pending and recovers after an error`, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>(); let request = 0;
  const run = () => ++request === 1 ? pending.promise : json(label === 'Connect'
    ? { ok: true, steps: [{ name: 'token', ok: true, detail: 'Recovered' }, { name: 'webhook', ok: true, detail: 'Set' }] }
    : { ok: true, running: true, statusCode: 200, detail: 'Recovered' });
  const h = harness(label === 'Connect' ? run : undefined, label === 'Test webhook' ? run : undefined);
  await mount(h); const action = button(h.pane, label); action.fire('click'); await flush();
  assert.equal(action.disabled, true);
  pending.resolve(json({ error: 'Request failed' }, 500)); await flush();
  assert.equal(action.disabled, false);
  assert.match(h.pane.querySelector(label === 'Connect' ? '.line-connect-result' : '.line-test-result')!.textContent, /Request failed/);
  action.fire('click'); await flush(); assert.equal(action.disabled, false);
  assert.match(h.pane.querySelector(label === 'Connect' ? '.line-connect-result' : '.line-test-result')!.textContent, /Recovered/);
});

test('public URL rejects HTTP and malformed input inline before saving settings or secrets', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  control(form, 'Replace token').value = 'fake-token';
  for (const url of ['http://tunnel.example', 'ftp://tunnel.example', 'https://']) {
    const publicUrl = control(form, 'Public URL'); publicUrl.value = url; publicUrl.fire('input');
    form.fire('submit'); await flush();
    assert.ok(!h.calls.some(c => c.method === 'PUT'));
    assert.equal(publicUrl.attrs['aria-invalid'], 'true');
    assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /Public URL/.test(n.textContent)));
  }
  const publicUrl = control(form, 'Public URL'); publicUrl.value = 'https://valid.example'; publicUrl.fire('input');
  form.fire('submit'); await flush();
  assert.equal(h.config().line.publicUrl, 'https://valid.example');
  assert.equal(publicUrl.attrs['aria-invalid'], 'false');
});

test('slow response is edited in seconds and saved in milliseconds with 1-55 bounds', async t => {
  t.after(installDom());
  for (const [ms, seconds] of [[1000, '1'], [45000, '45'], [55000, '55']] as const) {
    const h = harness(undefined, undefined, status, ms); const form = await mount(h);
    assert.equal(control(form, 'Slow response (seconds)').value, seconds);
    assert.ok(form.textContent.includes("Under 55 seconds, so LINE's reply token is still valid."));
    form.fire('submit'); await flush(); assert.equal(h.config().line.slowResponseMs, ms);
  }
  const h = harness(); const form = await mount(h);
  const slow = control(form, 'Slow response (seconds)');
  for (const value of ['0', '56', '1.5', '', 'invalid']) {
    slow.value = value; slow.fire('input'); form.fire('submit'); await flush();
    assert.ok(!h.calls.some(c => c.method === 'PUT'));
    assert.equal(slow.attrs['aria-invalid'], 'true');
    assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /1.*55/.test(n.textContent)));
  }
  slow.value = '12'; slow.fire('input'); form.fire('submit'); await flush();
  assert.equal(h.config().line.slowResponseMs, 12000);
  assert.equal(control(h.pane, 'Slow response (seconds)').value, '12');
});

test('native URL validation displays the inline error when it prevents form submission', async t => {
  t.after(installDom());
  const h = harness(); const form = await mount(h);
  const publicUrl = control(form, 'Public URL'); publicUrl.value = 'https://'; publicUrl.fire('invalid');
  assert.equal(publicUrl.attrs['aria-invalid'], 'true');
  assert.ok(form.querySelectorAll('.error').some(n => !n.hidden && /Public URL/.test(n.textContent)));
});

test('saving keeps the validated slow-response value while a settings request is pending', async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>(); let stored = structuredClone(config);
  stored.line.port = 47822;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/line/status') return json(status);
    if (path === '/api/settings') {
      if (init?.method === 'PUT') stored = JSON.parse(String(init.body)).config;
      return json({ config: stored, secrets: {} });
    }
    if (path === '/api/secrets') return pending.promise;
    assert.fail(path);
  }) as typeof fetch });
  const pane = new TestNode('div'); mountMessaging(pane as unknown as HTMLElement, api); await flush();
  const form = pane.querySelector('form')!; control(form, 'Replace token').value = 'fake-token';
  const slow = control(form, 'Slow response (seconds)'); slow.value = '12';
  form.fire('submit'); await flush();
  assert.equal(button(form, 'Save').disabled, true);
  slow.value = '0'; pending.resolve(json({ masked: '••••' })); await flush();
  assert.equal(stored.line.slowResponseMs, 12000);
});
