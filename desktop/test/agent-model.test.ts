import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountAgents } from '../src/agents.ts';
import { createChat } from '../src/chat.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';
import type { Agent } from '../src/types.ts';

const button = (node: TestNode, label: string) => node.querySelectorAll('button').find(b => b.textContent === label)!;
const control = (node: TestNode, label: string) => {
  const field = node.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label)!;
  assert.ok(field, `Missing field: ${label}`);
  return field.querySelector('input') ?? field.querySelector('select')!;
};

function harness(models: (id: string) => Response | Promise<Response> = () => json({ ok: true, models: [] }), saved: Agent = agent) {
  const stored = structuredClone(config);
  stored.providers.push({ id: 'remote', kind: 'anthropic', label: 'Remote', baseUrl: 'https://provider.example' });
  let agents = [structuredClone(saved)];
  const writes: { method: string; body: any }[] = [];
  const requests: string[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
    requests.push(path);
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path === '/api/settings') return json({ config: stored, secrets: {} });
    if (path === '/api/mcp') return json({ servers: [] });
    if (path === '/api/skills') return json({ skills: [] });
    if (path.startsWith('/api/providers/')) return models(decodeURIComponent(path.split('/')[3]!));
    if (path === '/api/agents' && method === 'GET') return json({ agents });
    if ((path === '/api/agents' && method === 'POST') || method === 'PATCH') {
      writes.push({ method, body });
      agents = [{ ...agent, ...body }]; return json(agents[0]);
    }
    assert.fail(`Unexpected request: ${method} ${path}`);
  }) as typeof fetch });
  const pane = new TestNode('div');
  return { api, pane, writes, requests };
}

async function edit(h: ReturnType<typeof harness>, create = false) {
  mountAgents(h.pane as unknown as HTMLElement, h.api, () => {}); await flush();
  button(h.pane, create ? 'Create agent' : 'Edit').fire('click');
  return h.pane.querySelector('form')!;
}

test('model suggestions reload for the selected provider without choosing or overwriting a typed model', async t => {
  t.after(installDom());
  const local = Promise.withResolvers<Response>();
  const h = harness(id => id === 'local' ? local.promise : json({ ok: true, models: [{ id: 'remote-model', label: 'Remote model' }] }));
  const form = await edit(h);
  assert.ok(h.requests.includes('/api/providers/local/models'));
  const model = control(form, 'Model'); model.value = 'my/custom-model';
  const provider = control(form, 'Provider'); provider.value = 'remote'; provider.fire('change'); await flush();
  assert.ok(h.requests.includes('/api/providers/remote/models'));
  assert.equal(model.value, 'my/custom-model');
  const list = form.querySelector('datalist')!;
  assert.equal(model.attrs.list, list.attrs.id);
  assert.deepEqual(list.querySelectorAll('option').map(o => o.value), ['remote-model']);
  assert.equal(list.querySelector('option')!.attrs.selected, undefined);
  local.resolve(json({ ok: true, models: [{ id: 'old-local' }] })); await flush();
  assert.deepEqual(list.querySelectorAll('option').map(o => o.value), ['remote-model']);
  assert.equal(model.value, 'my/custom-model');
});

test('a late model-list failure cannot replace the new provider suggestions or show a stale error', async t => {
  t.after(installDom());
  const local = Promise.withResolvers<Response>();
  const h = harness(id => id === 'local' ? local.promise : json({ ok: true, models: [{ id: 'current' }] }));
  const form = await edit(h);
  const provider = control(form, 'Provider'); provider.value = 'remote'; provider.fire('change'); await flush();
  local.resolve(json({ ok: false, models: [], error: 'old error' })); await flush();
  assert.equal(form.querySelector('datalist')!.querySelector('option')!.value, 'current');
  assert.ok(!form.textContent.includes('old error'));
});

for (const failure of ['provider', 'http', 'network']) test(`a ${failure} model-list failure shows a muted hint and still saves a free-text model`, async t => {
  t.after(installDom());
  const h = harness(() => {
    if (failure === 'network') throw new Error('offline');
    return failure === 'http' ? json({ error: 'list unavailable' }, 500) : json({ ok: false, models: [], error: 'list unavailable' });
  });
  const form = await edit(h); await flush();
  const hint = form.querySelectorAll('.muted').find(n => n.textContent.includes("Couldn't load the model list:"));
  assert.ok(hint); assert.match(hint.textContent, /You can still type a model id\./);
  control(form, 'Model').value = 'any/model'; form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.body.model, 'any/model');
});

test('old agents show Default and blank tokens, and the max-token help text is visible', async t => {
  t.after(installDom());
  const h = harness(undefined, { ...agent, provider: 'remote' });
  const form = await edit(h);
  assert.equal(control(form, 'Effort').value, '');
  assert.equal(control(form, 'Max tokens').value, '');
  assert.ok(form.textContent.includes("Blank uses the provider's setting. High effort spends tokens on thinking first: raise this if replies come back empty."));
  form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.body.effort, null); assert.equal(h.writes[0]!.body.maxTokens, null);
});

test('effort is shown only for supported providers, persists on edit and is cleared for other providers', async t => {
  t.after(installDom());
  const h = harness(undefined, { ...agent, provider: 'remote', effort: 'xhigh', maxTokens: 9000 });
  const form = await edit(h);
  assert.match(h.pane.querySelector('.agent-card')!.textContent, /remote · one-model · xhigh/);
  const effort = control(form, 'Effort');
  assert.equal(effort.parent!.parent!.hidden, false); assert.equal(effort.value, 'xhigh');
  assert.deepEqual(effort.querySelectorAll('option').map(o => [o.value, o.textContent]), [
    ['', 'Default'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'Extra high'], ['max', 'Max'],
  ]);
  assert.equal(control(form, 'Max tokens').value, '9000');
  form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.body.effort, 'xhigh'); assert.equal(h.writes[0]!.body.maxTokens, 9000);
  const next = h.pane.querySelectorAll('button').find(b => b.textContent === 'Edit')!; next.fire('click');
  const edited = h.pane.querySelector('form')!;
  const provider = control(edited, 'Provider'); provider.value = 'local'; provider.fire('change');
  assert.equal(control(edited, 'Effort').parent!.parent!.hidden, true);
  edited.fire('submit'); await flush(); assert.equal(h.writes[1]!.body.effort, null);
});

test('new agents save explicit effort and max tokens through POST', async t => {
  t.after(installDom());
  const h = harness(); const form = await edit(h, true);
  control(form, 'Name').value = 'New';
  const provider = control(form, 'Provider'); provider.value = 'remote'; provider.fire('change');
  control(form, 'Effort').value = 'max'; control(form, 'Max tokens').value = '1000000';
  form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.method, 'POST');
  assert.equal(h.writes[0]!.body.effort, 'max'); assert.equal(h.writes[0]!.body.maxTokens, 1000000);
});

test('clearing stored effort and tokens sends null, and model suggestions leave an empty input empty', async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>();
  const h = harness(() => pending.promise, { ...agent, provider: 'remote', effort: 'high', maxTokens: 10 });
  const form = await edit(h); control(form, 'Model').value = '';
  pending.resolve(json({ ok: true, models: [{ id: 'suggested' }] })); await flush();
  assert.equal(control(form, 'Model').value, '');
  control(form, 'Model').value = 'typed'; control(form, 'Effort').value = ''; control(form, 'Max tokens').value = '';
  form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.body.effort, null); assert.equal(h.writes[0]!.body.maxTokens, null);
});

test('invalid native number input is blocked inline even when the browser exposes an empty value', async t => {
  t.after(installDom());
  const h = harness(); const form = await edit(h); const tokens = control(form, 'Max tokens');
  tokens.value = ''; tokens.validity.badInput = true; tokens.fire('invalid'); form.fire('submit'); await flush();
  assert.equal(h.writes.length, 0);
  assert.equal(tokens.attrs['aria-invalid'], 'true');
  assert.ok(form.querySelectorAll('.error').some(n => !n.hidden));
  tokens.validity.badInput = false; tokens.fire('input'); form.fire('submit'); await flush();
  assert.equal(h.writes[0]!.body.maxTokens, null); assert.equal(tokens.attrs['aria-invalid'], 'false');
});

test('max tokens accepts both bounds and blank, and blocks invalid values with an inline error', async t => {
  t.after(installDom());
  for (const value of ['0', '-1', '1.5', '1000001', 'invalid', '1', '1000000', '']) {
    const h = harness(); const form = await edit(h);
    const tokens = control(form, 'Max tokens'); tokens.value = value; tokens.fire('input');
    form.fire('submit'); await flush();
    if (['1', '1000000', ''].includes(value)) {
      assert.equal(h.writes[0]!.body.maxTokens, value === '' ? null : Number(value));
    } else {
      assert.equal(h.writes.length, 0, value);
      assert.match(form.querySelectorAll('.error').find(n => !n.hidden)!.textContent, /1.*1000000/);
      assert.equal(tokens.attrs['aria-invalid'], 'true');
    }
  }
});

test('transcript ignores thinking blocks and finishes tool rows only for actual results, including a refused run', async t => {
  t.after(installDom());
  let finished = false;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async url => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/agents') return json({ agents: [agent] });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [] });
    if (path === '/api/sessions') return json({ sessions: [{ id: 's1', agentId: agent.id, title: 'History', updatedAt: 1 }] });
    if (path === '/api/sessions/s1') return json({ id: 's1', agentId: agent.id, title: 'History', messages: [
      { role: 'assistant', content: [
        { type: 'tool_use', id: 'call', name: 'read_file', input: {} },
        { type: 'thinking', thinking: 'private thought', signature: 'sig-1', toolUseId: 'call', content: 'wrong output' },
        { type: 'redacted_thinking', data: 'private data', toolUseId: 'call', content: 'wrong output' },
        ...(finished ? [{ type: 'tool_result', toolUseId: 'call', content: 'real output' }] : []),
        { type: 'text', text: 'Refusal notice' },
      ] },
    ] });
    assert.fail(path);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode; await flush();
  root.querySelector('.session')!.fire('click'); await flush();
  assert.equal(root.querySelector('.tool-status')!.textContent, 'running');
  assert.equal(root.querySelector('.tool-out')!.textContent, '');
  assert.ok(!/private thought|private data|wrong output/.test(root.textContent));
  finished = true;
  chat.onEvent({ type: 'run_end', sessionId: 's1', runId: 'r1', status: 'refused', text: 'Refusal notice' }); await flush();
  assert.equal(root.querySelector('.tool-status')!.textContent, 'done');
  assert.equal(root.querySelector('.tool-out')!.textContent, 'real output');
  assert.match(root.textContent, /Refusal notice/);
});
