import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountAgents } from '../src/agents.ts';
import { mountProviders } from '../src/settings/providers.ts';
import { mountMemory } from '../src/settings/memory.ts';
import { mountSchedules } from '../src/settings/schedules.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { Agent } from '../src/types.ts';

function harness() {
  let agents: Agent[] = [structuredClone(agent), { ...structuredClone(agent), id: 'a2', name: 'Two', model: 'two-model' }];
  let stored = structuredClone(config);
  const calls: { path: string; method: string; body: any; agent: string | null }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const u = new URL(String(url)), path = u.pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body, agent: u.searchParams.get('agent') });
    if (path === '/api/settings') { if (method === 'PUT') stored = body.config; return json({ config: stored, secrets: {} }); }
    if (path === '/api/agents') {
      if (method === 'POST') { const created = { ...agent, ...body, id: 'new' }; agents.push(created); return json(created, 201); }
      return json({ agents });
    }
    if (path.startsWith('/api/agents/')) {
      const id = path.split('/').at(-1);
      if (method === 'DELETE') { agents = agents.filter(a => a.id !== id); return json({ ok: true }); }
      const a = agents.find(a => a.id === id)!;
      if (method === 'PATCH') Object.assign(a, body);
      return json(a);
    }
    if (path === '/api/mcp') return json({ servers: [{ name: 'rea', enabled: false, transport: 'stdio', connected: false }] });
    if (path === '/api/skills') return json({ skills: [{ name: 'demo', description: 'Demo' }] });
    if (path === '/api/memory') return json({ notes: [] });
    if (path === '/api/schedules') return json({ jobs: [] });
    assert.fail(path);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, calls, agents: () => agents, config: () => stored };
}
const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const field = (node: TestNode, label: string) => node.querySelectorAll('label').find(l => l.querySelector('.field-label')?.textContent === label)!.querySelector('input')
  ?? node.querySelectorAll('label').find(l => l.querySelector('.field-label')?.textContent === label)!.querySelector('textarea')!;

test('Agents edits all owned settings and LINE assignment, duplicates and guards last deletion', async t => {
  t.after(installDom());
  const h = harness();
  let changed = 0;
  mountAgents(h.pane as unknown as HTMLElement, h.api, () => { changed++; }); await flush();
  button(h.pane, 'Edit').fire('click');
  const form = h.pane.querySelector('form')!;
  field(form, 'Name').value = 'Edited'; field(form, 'Icon').value = '🔎';
  field(form, 'Instructions').value = '<script>plain text</script>'; field(form, 'Model').value = 'edited-model';
  button(form, 'Add permission').fire('click');
  const permission = form.querySelector('.kv')!;
  permission.querySelector('input')!.value = 'mcp__rea__*'; permission.querySelector('select')!.value = 'deny';
  const skills = form.querySelectorAll('fieldset').find(f => f.querySelector('legend')!.textContent === 'Skills')!;
  const boxes = skills.querySelectorAll('input'); boxes[0]!.checked = false; boxes[1]!.checked = true;
  form.fire('submit'); await flush();
  const edited = h.agents()[0]!;
  assert.equal(edited.name, 'Edited'); assert.equal(edited.icon, '🔎'); assert.equal(edited.model, 'edited-model');
  assert.equal(edited.instructions, '<script>plain text</script>'); assert.deepEqual(edited.permissions, { 'mcp__rea__*': 'deny' });
  assert.deepEqual(edited.skills, ['demo']); assert.deepEqual(edited.connectors, []);
  assert.equal(h.config().line.agentId, 'a1'); assert.equal(h.config().active.model, 'seed-only');
  button(h.pane, 'Duplicate').fire('click'); await flush();
  assert.equal(h.agents().at(-1)!.instructions, edited.instructions); assert.equal(changed, 2);
  const last = harness(); last.agents().splice(1);
  mountAgents(last.pane as unknown as HTMLElement, last.api, () => {}); await flush();
  assert.ok(!last.pane.querySelectorAll('button').some(b => b.textContent === 'Delete'));
});

test('Providers shows and patches the selected agent model rather than the seed model', async t => {
  t.after(installDom());
  const h = harness();
  mountProviders(h.pane as unknown as HTMLElement, h.api, 'a2'); await flush();
  assert.equal(field(h.pane, 'Model').value, 'two-model');
  field(h.pane, 'Model').value = 'changed'; button(h.pane, 'Save').fire('click'); await flush();
  assert.equal(h.agents()[1]!.model, 'changed'); assert.equal(h.agents()[0]!.model, 'one-model');
  assert.equal(h.config().active.model, 'seed-only');
  assert.ok(!h.calls.some(c => c.path === '/api/settings' && c.method === 'PUT'));
});

test('Memory and Schedules filter and create with an explicit agent owner', async t => {
  t.after(installDom());
  for (const mount of [mountMemory, mountSchedules]) {
    const h = harness(); mount(h.pane as unknown as HTMLElement, h.api); await flush();
    const selectors = h.pane.querySelectorAll('select');
    const filter = selectors.find(s => s.querySelectorAll('option').some(o => o.textContent === 'All agents'))!;
    filter.value = 'a2'; filter.fire('change'); await flush();
    const path = mount === mountMemory ? '/api/memory' : '/api/schedules';
    assert.equal(h.calls.filter(c => c.path === path).at(-1)!.agent, 'a2');
    const form = h.pane.querySelector('form')!;
    const owner = form.querySelectorAll('select').find(s => s.querySelectorAll('option').some(o => o.value === 'a2'))!;
    owner.value = 'a2';
    form.querySelector('textarea')!.value = 'Owned note or prompt';
    if (mount === mountMemory) form.querySelector('select')!.value = 'agent';
    else form.querySelector('input')!.value = '0 9 * * *';
    form.fire('submit'); await flush();
    assert.equal(h.calls.find(c => c.path === path && c.method === 'POST')!.body.agentId, 'a2');
  }
});

test('Providers falls back when the previously selected agent was deleted', async t => {
  t.after(installDom());
  const h = harness();
  mountProviders(h.pane as unknown as HTMLElement, h.api, 'deleted'); await flush();
  assert.equal(field(h.pane, 'Model').value, 'one-model');
});
