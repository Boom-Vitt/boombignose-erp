import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { createChat } from '../src/chat.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';

import { agent, config } from './agent-fixture.ts';

const tag = { sessionId: 's1', runId: 'r1' };

function setup(post: () => Promise<Response>) {
  let history = () => Promise.resolve(json({ id: 's1', title: '', messages: [] }));
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/agents') return json({ agents: [agent] });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [{ name: 'rea', description: 'Reverse', usage: '/rea <path>', kind: 'builtin' }] });
    if (path === '/api/sessions' && init?.method === 'POST') return json({ id: 's1' });
    if (path === '/api/sessions') return json({ sessions: [] });
    if (path.endsWith('/messages')) return post();
    if (path === '/api/sessions/s1') return history();
    assert.fail(`Unexpected request: ${path}`);
  }) as typeof fetch });
  const chat = createChat(api);
  const root = chat.root as unknown as TestNode;
  const input = root.querySelector('textarea')!;
  const send = root.querySelectorAll('button').find((b) => b.textContent === 'Send')!;
  const stop = root.querySelectorAll('button').find((b) => b.textContent === 'Stop')!;
  return { chat, root, input, send, stop, delayHistory: (fn: () => Promise<Response>) => { history = fn; } };
}

test('run_end before the 202 leaves Send available and Stop hidden', async (t) => {
  t.after(installDom());
  const response = Promise.withResolvers<Response>();
  const { chat, input, send, stop } = setup(() => response.promise);
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  chat.onEvent({ type: 'run_start', ...tag });
  chat.onEvent({ type: 'run_end', ...tag, status: 'error', text: '', error: 'No key' });
  response.resolve(json({ runId: 'r1' }, 202));
  await flush();
  assert.equal(send.hidden, false);
  assert.equal(stop.hidden, true);
});

test('an accepted run keeps Stop until run_end', async (t) => {
  t.after(installDom());
  const { chat, input, send, stop } = setup(async () => json({ runId: 'r1' }, 202));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(stop.hidden, false);
  chat.onEvent({ type: 'run_end', ...tag, status: 'done', text: '' });
  assert.equal(send.hidden, false);
  await flush();
});

test('a rejected message restores the composer and draft', async (t) => {
  t.after(installDom());
  const { input, send, stop } = setup(async () => json({ error: 'Failed' }, 500));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(send.hidden, false);
  assert.equal(stop.hidden, true);
  assert.equal(input.value, 'hello');
});

test('a 409 keeps Stop available for the run already active on the daemon', async (t) => {
  t.after(installDom());
  const { input, send, stop } = setup(async () => json({ error: 'Already active' }, 409));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(stop.hidden, false);
  assert.equal(send.hidden, true);
  assert.equal(input.value, 'hello');
});

test('stream reset removes stale approvals and a slow refresh preserves replayed state', async (t) => {
  t.after(installDom());
  const { chat, root, input, send, stop, delayHistory } = setup(async () => json({ runId: 'r1' }, 202));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  chat.onEvent({ type: 'approval_request', ...tag, approvalId: 'old', tool: 'shell', input: {} });
  assert.equal(root.querySelectorAll('.approval').length, 1);
  chat.onStreamOpen();
  assert.equal(stop.hidden, true);
  assert.equal(root.querySelectorAll('.approval').length, 0);
  const history = Promise.withResolvers<Response>();
  delayHistory(() => history.promise);
  chat.refresh();
  chat.onEvent({ type: 'run_start', ...tag });
  chat.onEvent({ type: 'approval_request', ...tag, approvalId: 'new', tool: 'read_file', input: {} });
  assert.equal(stop.hidden, false);
  history.resolve(json({ id: 's1', title: '', messages: [] }));
  await flush();
  assert.equal(stop.hidden, false);
  assert.equal(root.querySelectorAll('.approval').length, 1);
  assert.match(root.querySelector('.approval')!.textContent, /read_file/);
  assert.equal(root.querySelectorAll('button').filter((b) => ['Allow', 'Deny'].includes(b.textContent)).length, 2);
});

test('connector 409 clears running state, asks before enabling, then resends the original message', async t => {
  t.after(installDom());
  let accepted = false;
  const calls: string[] = [];
  let saved = structuredClone(agent);
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push(`${init?.method} ${path}`);
    if (path === '/api/agents') return json({ agents: [saved] });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [] });
    if (path === '/api/sessions' && init?.method === 'POST') { assert.equal(body.agentId, agent.id); return json({ id: 's1' }); }
    if (path === '/api/sessions') return json({ sessions: [] });
    if (path === '/api/sessions/s1/messages') {
      assert.equal(body.text, '/rea /tmp/target');
      return accepted ? json({ runId: 'r1' }, 202) : json({ error: 'off', connector: 'rea' }, 409);
    }
    if (path === '/api/agents/a1') {
      if (init?.method === 'PATCH') { saved = { ...saved, ...body }; accepted = true; }
      return json(saved);
    }
    if (path === '/api/mcp/rea') { assert.deepEqual(body, { enabled: true }); return json({ ok: true }); }
    assert.fail(path);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode;
  await flush();
  const input = root.querySelector('textarea')!;
  const button = (name: string) => root.querySelectorAll('button').find(b => b.textContent === name)!;
  input.value = '/rea /tmp/target'; button('Send').fire('click'); await flush();
  assert.equal(button('Stop').hidden, true);
  assert.match(root.querySelector('.connector-confirm')!.textContent, /Turn on rea for One/);
  assert.ok(!calls.some(c => c.startsWith('PATCH')));
  button('Turn on').fire('click'); await flush();
  assert.deepEqual(saved.connectors, ['rea']);
  assert.equal(calls.filter(c => c === 'POST /api/sessions/s1/messages').length, 2);
  assert.equal(button('Stop').hidden, false);
});

test('pending createSession cannot select its chat after navigation', async t => {
  t.after(installDom());
  const created = Promise.withResolvers<Response>();
  let sent = false;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/agents') return json({ agents: [agent] });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [] });
    if (path === '/api/sessions' && init?.method === 'POST') return created.promise;
    if (path === '/api/sessions') return json({ sessions: [] });
    if (path.endsWith('/messages')) { sent = true; return json({ runId: 'r1' }, 202); }
    assert.fail(path);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode;
  await flush();
  root.querySelector('textarea')!.value = 'hello';
  root.querySelectorAll('button').find(b => b.textContent === 'Send')!.fire('click');
  await flush(); chat.leave();
  created.resolve(json({ id: 'late' })); await flush();
  assert.equal(sent, false);
  assert.equal(root.querySelectorAll('.msg').length, 0);
  assert.equal(root.querySelectorAll('button').find(b => b.textContent === 'Stop')!.hidden, true);
});

test('slash picker supports filtering, arrows, Tab, Enter, Escape and mouse', async t => {
  t.after(installDom());
  const { root, input } = setup(async () => json({ runId: 'r1' }, 202));
  await flush();
  const key = (key: string) => input.fire('keydown', { key, preventDefault() {}, isComposing: false });
  input.value = '/'; input.fire('input');
  assert.equal(root.querySelector('.slash-picker')!.hidden, false);
  key('ArrowDown'); key('Tab'); assert.equal(input.value, '/rea ');
  input.value = '/r'; input.fire('input'); key('Enter'); assert.equal(input.value, '/rea ');
  input.value = '/'; input.fire('input'); key('Escape'); assert.equal(root.querySelector('.slash-picker')!.hidden, true);
  input.value = '/no-match'; input.fire('input'); assert.equal(root.querySelector('.slash-picker')!.hidden, true);
  input.value = '/'; input.fire('input'); root.querySelector('.slash-option')!.fire('click'); assert.equal(input.value, '/rea ');
});

test('late completion does not append the old chat error after navigation', async t => {
  t.after(installDom());
  const { chat, root, input, send, delayHistory } = setup(async () => json({ runId: 'r1' }, 202));
  await flush(); input.value = 'hello'; send.fire('click'); await flush();
  const history = Promise.withResolvers<Response>(); delayHistory(() => history.promise);
  chat.onEvent({ type: 'run_end', ...tag, status: 'error', text: '', error: 'old failure' });
  root.querySelectorAll('button').find(b => b.textContent === 'New chat')!.fire('click');
  history.resolve(json({ id: 's1', title: '', messages: [] })); await flush();
  assert.ok(!root.textContent.includes('old failure'));
});

test('switching agents scopes the session list, new chats and the chat model update', async t => {
  t.after(installDom());
  const agents = [structuredClone(agent), { ...structuredClone(agent), id: 'a2', name: 'Two', model: 'two-model' }];
  const calls: { path: string; agent: string | null; body: any }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const u = new URL(String(url)), path = u.pathname, body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, agent: u.searchParams.get('agent'), body });
    if (path === '/api/agents') return json({ agents });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [] });
    if (path === '/api/sessions') return init?.method === 'POST' ? json({ id: 's2' }) : json({ sessions: [] });
    if (path === '/api/sessions/s2/messages') return json({ runId: 'r2' }, 202);
    if (path === '/api/agents/a2') { Object.assign(agents[1]!, body); return json(agents[1]); }
    assert.fail(path);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode;
  await flush(); await chat.selectAgent('a2');
  assert.equal(calls.filter(c => c.path === '/api/sessions').at(-1)!.agent, 'a2');
  const model = root.querySelector('.chat-model')!.querySelector('input')!;
  assert.equal(model.value, 'two-model'); model.value = 'edited';
  root.querySelectorAll('button').find(b => b.textContent === 'Save model')!.fire('click'); await flush();
  assert.equal(agents[1]!.model, 'edited'); assert.equal(config.active.model, 'seed-only');
  root.querySelector('textarea')!.value = 'hello';
  root.querySelectorAll('button').find(b => b.textContent === 'Send')!.fire('click'); await flush();
  assert.equal(calls.find(c => c.path === '/api/sessions' && c.body.agentId)!.body.agentId, 'a2');
});
