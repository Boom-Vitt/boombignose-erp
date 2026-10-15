import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountModel } from '../src/settings/providers.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { Agent, Config } from '../src/types.ts';
import type { TestContext } from 'node:test';

const control = (node: TestNode, label: string) => {
  const found = node.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label);
  assert.ok(found, `Missing field: ${label}`);
  return found.querySelector('input') ?? found.querySelector('select')!;
};
const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const radios = (node: TestNode) => node.querySelectorAll('input').filter(i => i.attrs.type === 'radio');
// a real input event fires on the field and bubbles to the form; the fixture has no bubbling, so both are fired
const type = (form: TestNode, field: TestNode, value: string) => { field.value = value; field.fire('input'); form.fire('input'); };
const barText = (node: TestNode) => node.querySelector('.save-bar-text')!.textContent;
function withToasts(t: TestContext) {
  t.after(installDom());
  const host = new TestNode('div');
  (globalThis.document as unknown as { getElementById: () => TestNode }).getElementById = () => host;
  return host;
}
const barShown = (node: TestNode) => !node.querySelector('.save-bar')!.hidden;

function harness(change?: (c: Config) => void, over: { ollamaUp?: boolean; statusFails?: boolean; patchFails?: string } = {}) {
  const stored: Config = structuredClone(config);
  stored.providers = [{ id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', contextWindow: 32768 },
    { id: 'remote', kind: 'anthropic', label: 'Remote', baseUrl: 'http://127.0.0.1:1', apiKeyEnv: 'REMOTE_API_KEY' }];
  stored.active = { provider: 'ollama', model: 'qwen3:4b' };
  change?.(stored);
  let current = stored;
  const agents: Agent[] = [{ ...agent, id: 'a1', provider: 'ollama', model: 'qwen3:4b' }, { ...agent, id: 'a2', name: 'Two', provider: 'remote', model: 'claude-x' }];
  const calls: { path: string; method: string; body: any }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    if (path === '/api/settings') { if (method === 'PUT') current = body.config; return json({ config: current, secrets: { OLLAMA_API_KEY: '', REMOTE_API_KEY: '••••1234' } }); }
    if (path === '/api/agents') return json({ agents });
    if (path.startsWith('/api/agents/') && method === 'PATCH') { if (path.endsWith(`/${over.patchFails}`)) return json({ error: 'Agent is busy' }, 500); Object.assign(agents.find(a => a.id === path.split('/').at(-1))!, body); return json({}); }
    if (path === '/api/secrets') return json({ name: body.name, masked: '••••' });
    if (path === '/api/providers/ollama/status') return over.statusFails ? json({ error: 'Status unavailable' }, 500) : json({ note: 'Ollama context note', warnings: ['Small context'] });
    if (path === '/api/providers/remote/status') return json({ warnings: [] });
    if (path === '/api/providers/ollama/models') return json(over.ollamaUp === false ? { ok: false, models: [], error: 'refused' } : { ok: true, models: [{ id: 'qwen3:4b' }, { id: 'qwen3:8b' }] });
    if (path === '/api/providers/remote/models') return json({ ok: false, models: [], error: 'No models' });
    assert.fail(`${method} ${path}`);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, calls, agents, config: () => current };
}
const open = async (h: ReturnType<typeof harness>, changed: () => void = () => {}) => {
  mountModel(h.pane as unknown as HTMLElement, h.api, changed); await flush();
  return h.pane.querySelector('form')!;
};

test('Model offers two Runs on cards, tells whether Ollama is running, and keeps the Ollama context note and warnings', async t => {
  t.after(installDom());
  const h = harness(); await open(h);
  assert.equal(radios(h.pane).length, 2);
  const cards = h.pane.querySelectorAll('.choice');
  assert.match(cards[0]!.textContent, /This Mac.*Free and private.*Running/); assert.match(cards[1]!.textContent, /A cloud service.*API key/);
  assert.equal(radios(h.pane)[0]!.checked, true);
  assert.ok(h.pane.textContent.includes('Ollama context note')); assert.ok(h.pane.querySelectorAll('.warn').some(n => n.textContent === 'Small context'));
  assert.ok(h.pane.textContent.includes('Every agent uses this model unless you pick another one for that agent.'));
  assert.equal(h.pane.querySelectorAll('details').length, 1, 'one More options fold');
  assert.deepEqual(h.pane.querySelectorAll('.group-title').filter(n => /advanced/i.test(n.textContent)), []);
  assert.equal(control(h.pane, 'API key (optional)').attrs.type, 'password');
  const down = harness(undefined, { ollamaUp: false }); await open(down);
  assert.match(down.pane.querySelectorAll('.choice')[0]!.textContent, /Not running/);
  assert.match(down.pane.querySelector('.test-line')!.textContent, /Ollama isn't running\. Open Ollama, then try again\./);
});

test('Model keeps what the owner typed when the suggestions arrive, and a failed status does not hide the page', async t => {
  t.after(installDom());
  const h = harness(undefined, { statusFails: true }); const form = await open(h);
  assert.ok(h.pane.textContent.includes('Status unavailable'));
  assert.deepEqual(h.pane.querySelector('datalist')!.querySelectorAll('option').map(o => o.value), ['qwen3:4b', 'qwen3:8b']);
  control(form, 'Model').value = 'typed/custom'; form.fire('input');
  assert.equal(control(form, 'Model').value, 'typed/custom');
});

test('typing a new model names the change in the save bar, and putting it back hides the bar', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  assert.equal(barShown(h.pane), false);
  const model = control(form, 'Model');
  type(form, model, 'qwen3:8b');
  assert.equal(barShown(h.pane), true); assert.equal(barText(h.pane), 'Model changed from qwen3:4b to qwen3:8b');
  assert.match(h.pane.querySelector('.test-line')!.textContent, /Not tested yet\./);
  type(form, control(form, 'Most steps per answer'), '12');
  assert.equal(barText(h.pane), 'Model and Most steps per answer changed');
  type(form, control(form, 'Most steps per answer'), '30'); type(form, model, 'qwen3:4b');
  assert.equal(barShown(h.pane), false);
});

test('saving a new default model writes config.active, moves the agents that followed the old one and leaves the others', async t => {
  t.after(installDom());
  const h = harness(c => { c.agent.workspace = 'relative/stale'; }); let changed = 0;
  const form = await open(h, () => { changed++; });
  type(form, control(form, 'Model'), 'qwen3:8b');
  form.fire('submit'); await flush();
  assert.deepEqual(h.config().active, { provider: 'ollama', model: 'qwen3:8b' });
  assert.equal(h.config().agent.workspace, 'relative/stale', 'a stored workspace is never judged by this save');
  assert.deepEqual(h.calls.filter(c => c.method === 'PATCH').map(c => [c.path, c.body]), [['/api/agents/a1', { provider: 'ollama', model: 'qwen3:8b' }]]);
  assert.deepEqual(h.agents.map(a => a.model), ['qwen3:8b', 'claude-x']);
  assert.equal(changed, 1);
});

test('pasting an API key says "API key replaced", never shows the key, and saves it as a secret', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  const key = control(form, 'API key (optional)');
  type(form, key, 'paste-me-123');
  assert.equal(barText(h.pane), 'API key replaced'); assert.ok(!h.pane.textContent.includes('paste-me-123'));
  form.fire('submit'); await flush();
  assert.deepEqual(h.calls.find(c => c.path === '/api/secrets')!.body, { name: 'OLLAMA_API_KEY', value: 'paste-me-123' });
  assert.ok(!JSON.stringify(h.config()).includes('paste-me-123'));
});

test('the cloud card shows the Service and the API key, and saving writes the chosen provider and model', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  const [mac, cloud] = radios(h.pane);
  assert.equal(h.pane.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'Service')!.hidden, true);
  cloud!.checked = true; mac!.checked = false; cloud!.fire('change'); await flush();
  assert.equal(h.pane.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'Service')!.hidden, false);
  assert.ok(h.pane.textContent.includes('Saved as ••••1234. Paste a new key to replace it.'));
  assert.equal(control(form, 'Service').querySelectorAll('option').map(o => o.value).join(), 'remote', 'cloud services only');
  type(form, control(form, 'Model'), 'claude-y'); type(form, control(form, 'API key'), 'paste-me-456');
  assert.equal(barText(h.pane), 'Runs on and 2 more changed');
  form.fire('submit'); await flush();
  assert.deepEqual(h.config().active, { provider: 'remote', model: 'claude-y' });
  assert.deepEqual(h.calls.find(c => c.path === '/api/secrets')!.body, { name: 'REMOTE_API_KEY', value: 'paste-me-456' });
});

test('the test line says what it checked, and typing resets it to "Not tested yet." until Test is pressed', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  const line = () => h.pane.querySelector('.test-line')!;
  assert.match(line().textContent, /Ollama is running · 2 models on this Mac/); assert.equal(button(line(), 'Check again').disabled, false);
  type(form, control(form, 'Model'), 'nope:1');
  assert.match(line().textContent, /Not tested yet\./);
  button(line(), 'Test').fire('click'); await flush();
  assert.match(line().textContent, /nope:1 isn't on this Mac\. Run `ollama pull nope:1`, or pick another model\./); assert.match(line().className, /bad/);
  type(form, control(form, 'Model'), 'qwen3:8b'); button(line(), 'Test').fire('click'); await flush();
  assert.match(line().textContent, /Ollama is running/); assert.ok(!/bad/.test(line().className));
});

test('context window and address are kept per provider and validated before anything is saved', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  type(form, control(form, 'Context window'), '16000');
  assert.equal(barText(h.pane), 'Context window changed from 32768 to 16000');
  type(form, control(form, 'Ollama address'), 'ftp://nope'); form.fire('submit'); await flush();
  assert.ok(!h.calls.some(c => c.method === 'PUT'), 'a bad address saves nothing');
  type(form, control(form, 'Ollama address'), 'http://127.0.0.1:11434/v1'); form.fire('submit'); await flush();
  assert.equal(h.config().providers[0]!.contextWindow, 16000);
});

test('the test line never speaks for an unsaved address or key: it says to save first, and goes back when they are put back', async t => {
  t.after(installDom());
  const h = harness(); const form = await open(h);
  const line = () => h.pane.querySelector('.test-line')!;
  assert.match(line().textContent, /Ollama is running/);
  type(form, control(form, 'Ollama address'), 'http://127.0.0.1:9999/v1');
  assert.match(line().textContent, /Save to test the new address\./); assert.equal(button(line(), 'Test').disabled, true);
  type(form, control(form, 'API key (optional)'), 'paste-me-123');
  assert.match(line().textContent, /Save to test the new address and key\./);
  type(form, control(form, 'Ollama address'), 'http://127.0.0.1:11434/v1');
  assert.match(line().textContent, /Save to test the new key\./);
  type(form, control(form, 'API key (optional)'), '');
  assert.match(line().textContent, /Not tested yet\./); assert.equal(button(line(), 'Test').disabled, false);
  const listed = h.calls.filter(c => c.path === '/api/providers/ollama/models').length;
  button(line(), 'Test').fire('click'); await flush();
  assert.equal(h.calls.filter(c => c.path === '/api/providers/ollama/models').length, listed + 1, 'a saved address is tested again');
});

test('when an agent cannot be moved to the new default model, a toast names it and the others still move', async t => {
  const toasts = withToasts(t);
  const h = harness(c => { c.agent.workspace = '/tmp/work'; }, { patchFails: 'a1' });
  h.agents.push({ ...agent, id: 'a3', name: 'Three', provider: 'ollama', model: 'qwen3:4b' });
  const form = await open(h);
  type(form, control(form, 'Model'), 'qwen3:8b');
  form.fire('submit'); await flush();
  assert.deepEqual(h.config().active, { provider: 'ollama', model: 'qwen3:8b' });
  assert.deepEqual(h.agents.map(a => a.model), ['qwen3:4b', 'claude-x', 'qwen3:8b']);
  assert.match(toasts.textContent, new RegExp(`${agent.name} could not be moved to qwen3:8b and still use qwen3:4b`));
});
