import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addConnector, prepareConnector, secretName } from '../src/settings/connector-form.ts';
import type { ConnectorForm } from '../src/settings/connector-form.ts';
import { createApi } from '../src/api.ts';
import type { Settings } from '../src/types.ts';
import { mountConnectors } from '../src/settings/connectors.ts';
import { TestNode, flush, installDom, json } from './dom-fixture.ts';

const form: ConnectorForm = { name: 'my', transport: 'stdio', command: 'npx', args: '-y "a b"', url: '', pairs: [['K', 'fake-one']] };
function settings(): Settings {
  return { config: {
    version: 1, active: { provider: 'local', model: 'test' }, providers: [],
    agent: { maxTurns: 30, workspace: '/tmp/work', compactAt: 0.8 }, permissions: {}, hooks: {},
    mcp: { servers: {} }, line: { enabled: false, port: 1, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } },
    api: { port: 1 },
  }, secrets: {} };
}

test('connector secret names preserve case, punctuation and component boundaries', () => {
  for (const [a, b] of [
    [['my-server', 'KEY'], ['my_server', 'KEY']],
    [['Foo', 'KEY'], ['foo', 'KEY']],
    [['a_b', 'C'], ['a', 'B_C']],
    [['a', 'X-Key'], ['a', 'X_Key']],
  ]) {
    assert.notEqual(secretName(a[0], a[1]), secretName(b[0], b[1]));
    assert.match(secretName(a[0], a[1]), /^[A-Z_][A-Z0-9_]*$/);
  }
});

test('connector preparation creates references and leaves settings unchanged', () => {
  const original = settings();
  const before = structuredClone(original);
  assert.deepEqual(prepareConnector(form, original), {
    name: 'my', config: { transport: 'stdio', command: 'npx', args: ['-y', 'a b'], enabled: true, env: { K: '${MCP_6D79_4B}' } },
    secrets: [{ name: 'MCP_6D79_4B', value: 'fake-one' }],
  });
  assert.deepEqual(original, before);
  const http = prepareConnector({ ...form, transport: 'http', url: 'https://example.com/mcp', pairs: [['X-Key', 'fake-one']] }, original);
  assert.deepEqual(http.config, { transport: 'http', url: 'https://example.com/mcp', enabled: true, headers: Object.fromEntries([['X-Key', '${MCP_6D79_582D4B6579}']]) });
});

test('connector preparation refuses existing secrets and references even when unset', () => {
  const stored = settings();
  stored.secrets.MCP_6D79_4B = '••••fake';
  assert.throws(() => prepareConnector(form, stored), /already in use/);
  stored.secrets = {};
  stored.config.mcp.servers.other = { transport: 'stdio', command: 'other', enabled: false, env: { K: '${MCP_6D79_4B}' } };
  assert.throws(() => prepareConnector(form, stored), /already in use/);
  stored.config.mcp.servers.other = { transport: 'http', url: 'https://example.com', enabled: false, headers: { Authorization: 'Bearer ${MCP_6D79_4B}' } };
  assert.throws(() => prepareConnector(form, stored), /already in use/);
});

test('connector preparation validates the entire form including duplicate keys', () => {
  for (const change of [
    { name: '' }, { name: 'a.b' }, { command: ' ' },
    { transport: 'http', url: 'file:///tmp/mcp' }, { transport: 'http', url: 'bad' },
    { pairs: [['K', 'fake-one'], ['bad-name', 'fake-two']] },
    { pairs: [['K', 'fake-one'], ['K', 'fake-two']] }, { pairs: [['K', '']] },
    { pairs: [['K', 'fake-one'], ['NEXT', 'bad\nvalue']] },
    { transport: 'http', url: 'https://example.com', pairs: [['X-Key', 'fake-one'], ['x-key', 'fake-two']] },
  ]) assert.throws(() => prepareConnector({ ...form, ...change } as ConnectorForm, settings()));
  const stored = settings();
  stored.config.mcp.servers.my = { transport: 'stdio', command: 'other', enabled: false };
  assert.throws(() => prepareConnector(form, stored), /already exists/);
});

function fakeDaemon(fail: string | string[] = []) {
  const stored = settings();
  const secrets = new Map<string, string>();
  secrets.set('KEEP', 'fake-old');
  stored.secrets.KEEP = '••••';
  const calls: string[] = [];
  const failures = new Set(typeof fail === 'string' ? [fail] : fail);
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const call = `${init?.method} ${path}`;
    calls.push(call);
    if (failures.delete(call)) return json({ error: 'Rejected' }, 500);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (call === 'GET /api/settings') return json(stored);
    if (call === 'POST /api/mcp') {
      stored.config.mcp.servers[body.name] = body.config;
    } else if (call === 'PUT /api/secrets') {
      if (body.value) assert.equal(stored.config.mcp.servers.my.enabled, false);
      if (body.value) secrets.set(body.name, body.value); else secrets.delete(body.name);
    } else if (call === 'PATCH /api/mcp/my') {
      assert.equal(secrets.get('MCP_6D79_4B'), 'fake-one'); // enabled only after credentials exist
      stored.config.mcp.servers.my.enabled = body.enabled;
    } else if (call === 'DELETE /api/mcp/my') {
      delete stored.config.mcp.servers.my;
    } else assert.fail(`Unexpected request: ${call}`);
    return json({ ok: true });
  }) as typeof fetch });
  return { api, stored, secrets, calls };
}

test('adding reserves a disabled connector before secrets and enables it last', async () => {
  const { api, stored, secrets, calls } = fakeDaemon();
  await addConnector(api, form);
  assert.deepEqual(calls, ['GET /api/settings', 'POST /api/mcp', 'PUT /api/secrets', 'PATCH /api/mcp/my']);
  assert.equal(stored.config.mcp.servers.my.enabled, true);
  assert.equal(secrets.get('KEEP'), 'fake-old');
  assert.equal(secrets.get('MCP_6D79_4B'), 'fake-one');
});

test('invalid forms and rejected connector adds never write secrets', async () => {
  const invalid = fakeDaemon();
  await assert.rejects(addConnector(invalid.api, { ...form, pairs: [['K', 'fake-one'], ['invalid!', 'fake-two']] }));
  assert.deepEqual(invalid.calls, ['GET /api/settings']);
  const rejected = fakeDaemon('POST /api/mcp');
  await assert.rejects(addConnector(rejected.api, form), /Rejected/);
  assert.deepEqual(rejected.calls, ['GET /api/settings', 'POST /api/mcp']);
  assert.deepEqual([...rejected.secrets], [['KEEP', 'fake-old']]);
});

test('a preexisting credential stops connector creation before any write', async () => {
  const { api, stored, secrets, calls } = fakeDaemon();
  stored.secrets.MCP_6D79_4B = '••••old';
  secrets.set('MCP_6D79_4B', 'fake-old');
  await assert.rejects(addConnector(api, form), /already in use/);
  assert.deepEqual(calls, ['GET /api/settings']);
  assert.equal(secrets.get('MCP_6D79_4B'), 'fake-old');
});

test('a failed secret write removes the reserved connector without enabling it', async () => {
  const { api, stored, secrets, calls } = fakeDaemon('PUT /api/secrets');
  await assert.rejects(addConnector(api, form), /Rejected/);
  assert.equal(Object.hasOwn(stored.config.mcp.servers, 'my'), false);
  assert.deepEqual([...secrets], [['KEEP', 'fake-old']]);
  assert.ok(!calls.some((c) => c.startsWith('PATCH')));
});

test('failed rollback reports incomplete cleanup and leaves referenced secrets intact', async () => {
  const { api, stored, secrets } = fakeDaemon(['PATCH /api/mcp/my', 'DELETE /api/mcp/my']);
  await assert.rejects(addConnector(api, form), /cleanup was incomplete/);
  assert.equal(stored.config.mcp.servers.my.enabled, false);
  assert.equal(secrets.get('MCP_6D79_4B'), 'fake-one');
  assert.equal(secrets.get('KEEP'), 'fake-old');
});

test('failed activation rolls back the connector and only its newly allocated secrets', async () => {
  const { api, stored, secrets, calls } = fakeDaemon('PATCH /api/mcp/my');
  await assert.rejects(addConnector(api, form), /Rejected/);
  assert.deepEqual(calls, ['GET /api/settings', 'POST /api/mcp', 'PUT /api/secrets', 'PATCH /api/mcp/my', 'DELETE /api/mcp/my', 'PUT /api/secrets']);
  assert.equal(Object.hasOwn(stored.config.mcp.servers, 'my'), false);
  assert.deepEqual([...secrets], [['KEEP', 'fake-old']]);
});

test('connector names reject underscores before any writes', async () => {
  const { api, calls } = fakeDaemon();
  await assert.rejects(addConnector(api, { ...form, name: 'bad_name' }), /letters, digits or/);
  assert.deepEqual(calls, ['GET /api/settings']);
});

test('delete clears only its own unshared secrets and permits same-name credential rotation', async () => {
  const { deleteConnector } = await import('../src/settings/connector-form.ts');
  const { api, stored, secrets, calls } = fakeDaemon();
  await addConnector(api, form);
  stored.secrets.MCP_6D79_4B = '••••';
  const shared = secretName('my', 'SHARED'), unrelated = secretName('other', 'K');
  stored.secrets[shared] = stored.secrets[unrelated] = '••••';
  secrets.set(shared, 'fake-share'); secrets.set(unrelated, 'fake-other');
  stored.config.mcp.servers.other = { transport: 'http', enabled: false, url: 'http://127.0.0.1:1', headers: { Authorization: `Bearer \${${shared}}` } };
  await deleteConnector(api, 'my');
  assert.equal(secrets.has('MCP_6D79_4B'), false);
  assert.equal(secrets.get(shared), 'fake-share'); assert.equal(secrets.get(unrelated), 'fake-other');
  assert.ok(calls.indexOf('DELETE /api/mcp/my') < calls.lastIndexOf('PUT /api/secrets'));
  delete stored.secrets.MCP_6D79_4B;
  await addConnector(api, form);
  assert.equal(secrets.get('MCP_6D79_4B'), 'fake-one');
});

function mcpPane(servers: { name: string; connected: boolean; enabled?: boolean; starting?: boolean; error?: string }[], tools: Record<string, { name: string; selected: boolean }[]>) {
  const patches: { path: string; body: any }[] = [];
  const api = createApi({ port: 1, token: 'fake-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (init?.method === 'PATCH') { patches.push({ path, body: JSON.parse(String(init.body)) }); return json({ ok: true }); }
    if (path === '/api/mcp') return json({ servers: servers.map((s) => ({ transport: 'stdio', enabled: true, ...s })) });
    const name = path.split('/')[3]!;
    return json({ tools: tools[name] ?? [] });
  }) as typeof fetch });
  const pane = new TestNode('div');
  mountConnectors(pane as unknown as HTMLElement, api);
  const card = (name: string) => pane.querySelectorAll('section').find((s) => s.querySelector('h3')!.textContent.startsWith(name))!;
  const button = (node: TestNode, label: string) => node.querySelectorAll('button').find((b) => b.textContent === label);
  return { pane, patches, card, button };
}

test('Save selection is hidden while the connector is not connected', async (t) => {
  t.after(installDom());
  const h = mcpPane([{ name: 'off', connected: false, enabled: false }, { name: 'boot', connected: false, starting: true }, { name: 'live', connected: true }, { name: 'bare', connected: true }],
    { live: [{ name: 'echo', selected: true }, { name: 'add', selected: true }] });
  await flush();
  for (const name of ['off', 'boot']) {
    h.button(h.card(name), 'Tools')!.fire('click'); await flush();
    assert.equal(h.button(h.card(name), 'Save selection'), undefined, `${name}: no Save`);
    assert.equal(h.card(name).querySelector('.tool-picks'), null, `${name}: no empty picker`);
    assert.match(h.card(name).querySelector('.tools-panel')!.textContent, /turn this connector on/i);
  }
  h.button(h.card('bare'), 'Tools')!.fire('click'); await flush(); // connected but lists nothing: an empty save would hide every tool later
  assert.equal(h.button(h.card('bare'), 'Save selection'), undefined);
  assert.match(h.card('bare').querySelector('.tools-panel')!.textContent, /lists no tools/);

  h.button(h.card('live'), 'Tools')!.fire('click'); await flush();
  assert.deepEqual(h.card('live').querySelectorAll('.tool-pick').length, 2);
  h.button(h.card('live'), 'None')!.fire('click');
  h.button(h.card('live'), 'Save selection')!.fire('click'); await flush();
  assert.deepEqual(h.patches, [{ path: '/api/mcp/live', body: { tools: [] } }], 'a deliberate None on a connected connector still saves, and nothing else was saved');
});
