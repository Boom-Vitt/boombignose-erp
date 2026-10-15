import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountAgentForm, mountAgents } from '../src/agents.ts';
import { mountProviders } from '../src/settings/providers.ts';
import { mountMemory } from '../src/settings/memory.ts';
import { mountSchedules } from '../src/settings/schedules.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { Agent } from '../src/types.ts';

function harness() {
  let agents: Agent[] = [structuredClone(agent), { ...structuredClone(agent), id: 'a2', name: 'Two', model: 'two-model' }];
  let stored = structuredClone(config);
  let jobs: { agentId: string }[] = [];
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
    if (path === '/api/providers/local/models') return json({ ok: true, models: [] });
    if (path === '/api/memory') return json({ notes: [] });
    if (path === '/api/schedules') return json({ jobs });
    assert.fail(path);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, calls, agents: () => agents, config: () => stored, setJobs: (next: { agentId: string }[]) => { jobs = next; } };
}
const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const field = (node: TestNode, label: string) => node.querySelectorAll('label').find(l => l.querySelector('.field-label')?.textContent === label)!.querySelector('input')
  ?? node.querySelectorAll('label').find(l => l.querySelector('.field-label')?.textContent === label)!.querySelector('textarea')!;

const hash = () => (globalThis as any).window.location.hash as string;
const openForm = async (h: ReturnType<typeof harness>, id: string | undefined, changed: () => void = () => {}) => {
  mountAgentForm(h.pane as unknown as HTMLElement, h.api, id, changed); await flush();
  return h.pane.querySelector('form')!;
};
const row = (pane: TestNode, id: string) => pane.querySelectorAll('.agent-row').find(r => r.attrs['data-agent-id'] === id)!;

test('the agent form edits all owned settings, leaves LINE alone, and goes back to the roster', async t => {
  t.after(installDom());
  const h = harness();
  let changed = 0;
  const form = await openForm(h, 'a1', () => { changed++; });
  field(form, 'Name').value = 'Edited'; field(form, 'Icon').value = '🔎';
  field(form, 'Instructions').value = '<script>plain text</script>'; field(form, 'Model name').value = 'edited-model';
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
  assert.equal(h.config().line.agentId, undefined); assert.equal(h.config().active.model, 'seed-only');
  assert.ok(!h.calls.some(c => c.path === '/api/settings' && c.method === 'PUT'), 'LINE is chosen in Settings, not here');
  assert.equal(changed, 1); assert.equal(hash(), '#/agents');
});

test('the agent form shows a save bar only while something differs, and names what', async t => {
  t.after(installDom());
  const h = harness();
  const form = await openForm(h, 'a1');
  const bar = form.querySelector('.save-bar')!, text = () => bar.querySelector('.save-bar-text')!.textContent;
  assert.equal(bar.hidden, true);
  field(form, 'Name').value = 'Edited'; form.fire('input');
  assert.equal(bar.hidden, false); assert.equal(text(), 'Name changed');
  field(form, 'Instructions').value = 'Other'; form.fire('input');
  assert.equal(text(), 'Name and Instructions changed');
  field(form, 'Icon').value = '🔎'; form.fire('input');
  assert.equal(text(), 'Name and 2 more changed');
  field(form, 'Name').value = 'One'; field(form, 'Instructions').value = 'One instruction'; field(form, 'Icon').value = ''; form.fire('input');
  assert.equal(bar.hidden, true, 'putting every value back hides the bar');
  assert.deepEqual(bar.querySelectorAll('button').map(b => b.textContent), ['Discard', 'Save']);
  const fresh = await openForm(h, undefined);
  assert.equal(fresh.querySelector('.save-bar')!.hidden, false);
  assert.equal(fresh.querySelector('.save-bar-text')!.textContent, 'New agent');
  const buttons = fresh.querySelector('.save-bar')!.querySelectorAll('button');
  assert.deepEqual(buttons.map(b => b.textContent), ['Cancel', 'Create agent']);
  buttons[0]!.fire('click'); assert.equal(hash(), '#/agents');
});

test('an agent form for an agent that is gone says so, and a blank icon saves the default bot', async t => {
  t.after(installDom());
  const h = harness();
  mountAgentForm(h.pane as unknown as HTMLElement, h.api, 'missing', () => {}); await flush();
  assert.ok(h.pane.textContent.includes('That agent no longer exists.')); assert.equal(h.pane.querySelector('form'), null);
  const form = await openForm(h, 'a2');
  field(form, 'Icon').value = ''; form.fire('submit'); await flush();
  assert.equal(h.agents()[1]!.icon, '🤖');
});

test('What it may do: the groups write their tools, pressing the pressed one hands them back, and one tool cannot have two rules', async t => {
  t.after(installDom());
  const h = harness();
  h.agents()[0]!.permissions = { shell: 'allow', web_fetch: 'deny', 'mcp__x__*': 'ask' };
  const form = await openForm(h, 'a1');
  const group = (label: string) => form.querySelectorAll('.row').find(r => r.querySelector('.row-text')?.textContent.startsWith(label))!;
  const seg = (label: string, text: string) => group(label).querySelectorAll('button').find(b => b.textContent === text)!;
  const pressed = (label: string) => group(label).querySelectorAll('button').filter(b => b.attrs['aria-pressed'] === 'true').map(b => b.textContent);
  assert.deepEqual(pressed('Run commands'), ['Allow']); assert.deepEqual(pressed('Open web pages'), ['Never']); assert.deepEqual(pressed('Read files'), []);
  assert.equal(form.querySelectorAll('.kv').length, 1, 'only the tools no group covers get a rule row');
  form.fire('submit'); await flush();
  assert.deepEqual(h.agents()[0]!.permissions, { shell: 'allow', web_fetch: 'deny', 'mcp__x__*': 'ask' }, 'saving untouched keeps every rule');
  seg('Read files', 'Allow').fire('click'); seg('Run commands', 'Never').fire('click');
  assert.deepEqual(pressed('Read files'), ['Allow']); assert.deepEqual(pressed('Run commands'), ['Never']);
  form.fire('submit'); await flush();
  assert.deepEqual(h.agents()[0]!.permissions, { shell: 'deny', web_fetch: 'deny', read_file: 'allow', list_files: 'allow', search_files: 'allow', 'mcp__x__*': 'ask' });
  seg('Open web pages', 'Never').fire('click'); seg('Read files', 'Allow').fire('click');
  assert.deepEqual(pressed('Open web pages'), []); assert.deepEqual(pressed('Read files'), []);
  button(form, 'Add permission').fire('click');
  const added = form.querySelectorAll('.kv')[1]!; added.querySelector('input')!.value = 'shell';
  const writes = () => h.calls.filter(c => c.method === 'PATCH').length, before = writes();
  form.fire('submit'); await flush();
  assert.equal(writes(), before, 'shell already has a rule from Run commands');
  added.querySelector('input')!.value = 'mcp__y__*'; form.fire('submit'); await flush();
  assert.deepEqual(h.agents()[0]!.permissions, { shell: 'deny', 'mcp__x__*': 'ask', 'mcp__y__*': 'ask' });
});

test('the roster is one card of rows: avatar, name, what it is for, model, schedules and who answers LINE', async t => {
  t.after(installDom());
  const h = harness();
  h.agents()[0]!.instructions = 'Answers shop questions.\nSecond line';
  h.agents()[1]!.instructions = ''; h.agents()[1]!.icon = '🔎'; h.agents()[1]!.provider = 'remote'; h.agents()[1]!.name = 'ผู้ช่วย';
  h.setJobs([{ agentId: 'a2' }, { agentId: 'a2' }, { agentId: 'a1' }]);
  mountAgents(h.pane as unknown as HTMLElement, h.api, () => {}); await flush();
  assert.equal(h.pane.querySelectorAll('.agent-card').length, 0);
  const rows = h.pane.querySelectorAll('.agent-row'); assert.equal(rows.length, 2);
  for (const r of rows) for (const part of ['.avatar', '.agent-name', '.agent-mission']) assert.ok(r.querySelector(part), part);
  const [a1, a2] = [row(h.pane, 'a1'), row(h.pane, 'a2')] as [TestNode, TestNode];
  assert.equal(a1.querySelector('.agent-mission')!.textContent, 'Answers shop questions.');
  assert.equal(a2.querySelector('.agent-mission')!.textContent, 'General assistant');
  assert.ok(a1.querySelector('.avatar')!.className.includes('bot')); assert.ok(!a2.querySelector('.avatar')!.className.includes('bot'));
  assert.equal(a2.querySelector('.avatar')!.textContent, '🔎');
  assert.equal(a1.querySelector('.agent-meta')!.textContent, 'one-model · 1 schedule');
  assert.equal(a2.querySelector('.agent-meta')!.textContent, 'remote · two-model · 2 schedules');
  assert.match(a2.querySelector('a')!.attrs.href!, /#\/settings\/schedules\?agent=a2$/);
  assert.equal(a2.querySelector('.agent-name')!.querySelector('span')!.attrs.lang, 'th');
  assert.equal(h.pane.querySelectorAll('.badge').length, 0, 'no LINE badge while LINE is off');
  h.config().line.enabled = true; h.config().line.agentId = 'a2';
  const again = new TestNode('div'); mountAgents(again as unknown as HTMLElement, h.api, () => {}); await flush();
  assert.equal(again.querySelectorAll('.badge').length, 1); assert.ok(row(again, 'a2').querySelector('.badge'));
  assert.deepEqual(a1.querySelector('.menu')!.querySelectorAll('button').map(b => b.textContent), ['Edit…', 'Duplicate', 'Delete…']);
  assert.ok(!h.pane.textContent.includes('Use for LINE'));
  assert.equal(a1.querySelector('.agent-chat')!.textContent, 'Chat');
});

test('Chat, Edit… and New agent go to their pages, and the ⋯ menu opens and closes with its keys', async t => {
  t.after(installDom());
  const h = harness(); const opened: (string | undefined)[] = [];
  mountAgents(h.pane as unknown as HTMLElement, h.api, id => { opened.push(id); }); await flush();
  const a1 = row(h.pane, 'a1');
  button(a1, 'Chat').fire('click'); assert.deepEqual(opened, ['a1']); assert.equal(hash(), '#/chat');
  button(h.pane, 'New agent').fire('click'); assert.equal(hash(), '#/agents/new');
  const more = a1.querySelector('.icon-btn')!, menu = a1.querySelector('.menu')!;
  assert.equal(more.attrs['aria-haspopup'], 'menu'); assert.equal(menu.hidden, true);
  more.fire('click'); assert.equal(menu.hidden, false); assert.equal(more.attrs['aria-expanded'], 'true');
  menu.fire('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
  assert.equal(menu.hidden, true); assert.equal(more.attrs['aria-expanded'], 'false');
  more.fire('keydown', { key: 'ArrowDown', preventDefault() {} }); assert.equal(menu.hidden, false, 'ArrowDown opens it');
  row(h.pane, 'a2').querySelector('.icon-btn')!.fire('click'); assert.equal(menu.hidden, true, 'only one menu is open');
  button(menu, 'Edit…').fire('click'); assert.equal(hash(), '#/agents/a1');
});

test('Duplicate copies the agent; Delete… asks first, says what goes with it, and is off for the last agent', async t => {
  t.after(installDom());
  const dialogs: TestNode[] = [];
  (document as any).body = { appendChild: (n: TestNode) => { dialogs.push(n); return n; } };
  (TestNode.prototype as any).showModal = function () {};
  t.after(() => { Reflect.deleteProperty(TestNode.prototype, 'showModal'); });
  const answer = (dialog: TestNode, value: string) => { (dialog as any).returnValue = value; dialog.fire('close'); };
  const h = harness(); let changed = 0;
  h.config().line.enabled = true; h.setJobs([{ agentId: 'a1' }]);
  mountAgents(h.pane as unknown as HTMLElement, h.api, () => { changed++; }); await flush();
  button(row(h.pane, 'a1'), 'Duplicate').fire('click'); await flush();
  assert.equal(h.agents().at(-1)!.name, 'One copy'); assert.equal(changed, 1);
  button(row(h.pane, 'a1'), 'Delete…').fire('click'); await flush();
  const dialog = dialogs[0]!;
  assert.equal(dialog.querySelector('h2')!.textContent, 'Delete One?');
  assert.equal(dialog.querySelector('p')!.textContent, 'Its chats, its notes and its 1 schedule are deleted too. LINE will be answered by Two.');
  assert.deepEqual(dialog.querySelectorAll('button').map(b => b.textContent), ['Cancel', 'Delete']);
  answer(dialog, 'cancel'); await flush();
  assert.ok(!h.calls.some(c => c.method === 'DELETE'), 'Cancel deletes nothing');
  button(row(h.pane, 'a1'), 'Delete…').fire('click'); await flush();
  answer(dialogs[1]!, 'ok'); await flush();
  assert.ok(h.calls.some(c => c.method === 'DELETE' && c.path === '/api/agents/a1')); assert.ok(!h.agents().some(a => a.id === 'a1'));
  const last = harness(); last.agents().splice(1);
  mountAgents(last.pane as unknown as HTMLElement, last.api, () => {}); await flush();
  assert.equal(button(last.pane, 'Delete…').disabled, true);
  assert.ok(last.pane.textContent.includes('BigNose needs at least one agent.'));
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
