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
  const send = root.querySelector('.send')!; // one button: it reads "Send" when idle and "Stop" while a run is going
  const state = () => send.textContent;
  return { chat, root, input, send, state, delayHistory: (fn: () => Promise<Response>) => { history = fn; } };
}

test('run_end before the 202 leaves Send available', async (t) => {
  t.after(installDom());
  const response = Promise.withResolvers<Response>();
  const { chat, input, send, state } = setup(() => response.promise);
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  chat.onEvent({ type: 'run_start', ...tag });
  chat.onEvent({ type: 'run_end', ...tag, status: 'error', text: '', error: 'No key' });
  response.resolve(json({ runId: 'r1' }, 202));
  await flush();
  assert.equal(state(), 'Send');
});

test('an accepted run keeps Stop until run_end', async (t) => {
  t.after(installDom());
  const { chat, input, send, state } = setup(async () => json({ runId: 'r1' }, 202));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(state(), 'Stop');
  assert.equal(send.className, 'send stop');
  chat.onEvent({ type: 'run_end', ...tag, status: 'done', text: '' });
  assert.equal(state(), 'Send');
  assert.equal(send.className, 'send');
  await flush();
});

test('a rejected message restores the composer and draft', async (t) => {
  t.after(installDom());
  const { input, send, state } = setup(async () => json({ error: 'Failed' }, 500));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(state(), 'Send');
  assert.equal(input.value, 'hello');
});

test('a 409 keeps Stop available for the run already active on the daemon', async (t) => {
  t.after(installDom());
  const { input, send, state } = setup(async () => json({ error: 'Already active' }, 409));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(state(), 'Stop');
  assert.equal(input.value, 'hello');
});

test('stream reset removes stale approvals and a slow refresh preserves replayed state', async (t) => {
  t.after(installDom());
  const { chat, root, input, send, state, delayHistory } = setup(async () => json({ runId: 'r1' }, 202));
  await flush();
  input.value = 'hello'; send.fire('click');
  await flush();
  chat.onEvent({ type: 'approval_request', ...tag, approvalId: 'old', tool: 'shell', input: {} });
  assert.equal(root.querySelectorAll('.approval').length, 1);
  chat.onStreamOpen();
  assert.equal(state(), 'Send');
  assert.equal(root.querySelectorAll('.approval').length, 0);
  const history = Promise.withResolvers<Response>();
  delayHistory(() => history.promise);
  chat.refresh();
  chat.onEvent({ type: 'run_start', ...tag });
  chat.onEvent({ type: 'approval_request', ...tag, approvalId: 'new', tool: 'read_file', input: {} });
  assert.equal(state(), 'Stop');
  history.resolve(json({ id: 's1', title: '', messages: [] }));
  await flush();
  assert.equal(state(), 'Stop');
  assert.equal(root.querySelectorAll('.approval').length, 1);
  assert.match(root.querySelector('.approval')!.textContent, /read_file/);
  assert.deepEqual(root.querySelector('.approval-actions')!.querySelectorAll('button').map((b) => b.textContent), ['Deny', 'Allow once']);
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
  const sendBtn = root.querySelector('.send')!;
  input.value = '/rea /tmp/target'; sendBtn.fire('click'); await flush();
  assert.equal(sendBtn.textContent, 'Send');
  assert.match(root.querySelector('.connector-confirm')!.textContent, /Turn on rea for One/);
  assert.deepEqual(root.querySelector('.connector-confirm')!.querySelectorAll('button').map(b => b.textContent), ['Not now', 'Turn on']);
  assert.ok(!calls.some(c => c.startsWith('PATCH')));
  button('Turn on').fire('click'); await flush();
  assert.deepEqual(saved.connectors, ['rea']);
  assert.equal(calls.filter(c => c === 'POST /api/sessions/s1/messages').length, 2);
  assert.equal(sendBtn.textContent, 'Stop');
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
  root.querySelector('.send')!.fire('click');
  await flush(); chat.leave();
  created.resolve(json({ id: 'late' })); await flush();
  assert.equal(sent, false);
  assert.equal(root.querySelectorAll('.msg').length, 0);
  assert.equal(root.querySelector('.send')!.textContent, 'Send');
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
  chat.newChat();
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
  const model = root.querySelector('.model-link')!; // the chat shows the agent's model and links to Settings; it no longer edits it
  assert.equal(model.textContent, 'two-model');
  assert.equal(model.attrs.href, '#/settings/model');
  assert.equal(model.attrs['aria-label'], 'Model two-model. Change in Settings');
  assert.equal(root.querySelectorAll('select').length + root.querySelectorAll('input').length, 0, 'the header has no controls');
  root.querySelector('textarea')!.value = 'hello';
  root.querySelector('.send')!.fire('click'); await flush();
  assert.equal(calls.find(c => c.path === '/api/sessions' && c.body.agentId)!.body.agentId, 'a2');
});

function historySetup(read: (id: string) => Promise<Response>, commands = async () => json({ commands: [] })) {
  const agents = [agent, { ...agent, id: 'a2', name: 'Two' }];
  const sessions = [
    { id: 's1', agentId: 'a1', title: 'Saved s1', updatedAt: 1 },
    { id: 's2', agentId: 'a1', title: 'Saved s2', updatedAt: 1 },
    { id: 's3', agentId: 'a2', title: 'Saved s3', updatedAt: 1 },
  ];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async url => {
    const u = new URL(String(url));
    if (u.pathname === '/api/agents') return json({ agents });
    if (u.pathname === '/api/settings') return json({ config, secrets: {} });
    if (u.pathname === '/api/commands') return commands();
    if (u.pathname === '/api/sessions') return json({ sessions: sessions.filter(s => s.agentId === u.searchParams.get('agent')) });
    const id = /^\/api\/sessions\/(s[123])$/.exec(u.pathname)?.[1];
    if (id) return read(id);
    assert.fail(`Unexpected request: ${u.pathname}`);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode, sidebar = chat.sidebar as unknown as TestNode;
  const open = (id: string) => sidebar.querySelectorAll('.session').find(b => b.textContent.startsWith(`Saved ${id}`))!.fire('click');
  return { chat, root, sidebar, open, messages: root.querySelector('.messages')! };
}

const savedHistory = (id: string, text: string) => json({
  id, agentId: id === 's3' ? 'a2' : 'a1', title: `Saved ${id}`,
  messages: [{ role: 'assistant', content: [{ type: 'text', text }] }],
});

test('T16 returning resumes history invalidated by leaving and keeps settled history', { timeout: 2000 }, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async id => ++reads === 1 ? pending.promise : savedHistory(id, 'Recovered'));
  await flush(); open('s1'); await flush();
  assert.match(messages.textContent, /Loading…/);
  chat.leave();
  pending.resolve(savedHistory('s1', 'Cancelled answer')); await flush();
  assert.doesNotMatch(messages.textContent, /Cancelled answer/);
  await chat.refreshAgents(); await flush();
  assert.match(messages.textContent, /Recovered/);
  assert.doesNotMatch(messages.textContent, /Loading…/);
  chat.leave(); await chat.refreshAgents(); await flush();
  assert.equal(reads, 2, 'settled history must not reload on return');
  assert.match(messages.textContent, /Recovered/);
});

test('T16 failed return shows an error and Retry reloads the selected history', { timeout: 2000 }, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async id => {
    if (++reads === 1) return pending.promise;
    return reads === 2 ? json({ error: 'History unavailable' }, 503) : savedHistory(id, 'Retry recovered');
  });
  await flush(); open('s1'); await flush(); chat.leave();
  await chat.refreshAgents(); await flush();
  const error = messages.querySelector('.notice');
  assert.ok(error, 'failed history load must show an error');
  assert.equal(error.attrs.role, 'alert');
  assert.match(error.textContent, /History unavailable/);
  assert.doesNotMatch(messages.textContent, /Loading…/);
  assert.equal(error.querySelector('button')!.textContent, 'Retry');
  error.querySelector('button')!.fire('click'); await flush();
  assert.match(messages.textContent, /Retry recovered/);
  pending.resolve(json({ error: 'Stale failure' }, 500)); await flush();
  assert.doesNotMatch(messages.textContent, /Stale failure|Loading…/);
  assert.equal(messages.querySelector('.notice'), null);
});

test('T16 switching sessions before leave resumes only the current session', { timeout: 2000 }, async t => {
  t.after(installDom());
  const old = Promise.withResolvers<Response>(), current = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, sidebar, open, messages } = historySetup(async id => {
    if (id === 's1') return old.promise;
    return ++reads === 1 ? current.promise : savedHistory(id, 'Current session');
  });
  await flush(); open('s1'); await flush(); open('s2'); await flush(); chat.leave();
  await chat.refreshAgents(); await flush();
  assert.match(messages.textContent, /Current session/);
  assert.match(sidebar.querySelectorAll('.session').find(b => b.attrs['aria-current'] === 'true')!.textContent, /Saved s2/);
  old.resolve(savedHistory('s1', 'Old session')); current.resolve(savedHistory('s2', 'Cancelled current'));
  await flush();
  assert.match(messages.textContent, /Current session/);
  assert.doesNotMatch(messages.textContent, /Old session|Cancelled current|Loading…/);
});

test('T16 switching agents before leave fences the previous agent history', { timeout: 2000 }, async t => {
  t.after(installDom());
  const old = Promise.withResolvers<Response>(), current = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async id => {
    if (id === 's1') return old.promise;
    return ++reads === 1 ? current.promise : savedHistory(id, 'Agent Two history');
  });
  await flush(); open('s1'); await flush();
  await chat.selectAgent('a2'); open('s3'); await flush(); chat.leave();
  await chat.refreshAgents(); await flush();
  assert.equal(chat.agentId(), 'a2');
  assert.match(messages.textContent, /Agent Two history/);
  old.resolve(savedHistory('s1', 'Agent One history')); current.resolve(savedHistory('s3', 'Cancelled agent history'));
  await flush();
  assert.match(messages.textContent, /Agent Two history/);
  assert.doesNotMatch(messages.textContent, /Agent One history|Cancelled agent history|Loading…/);
});

test('T16 leaving again during recovery keeps the history eligible for the next return', { timeout: 2000 }, async t => {
  t.after(installDom());
  const first = Promise.withResolvers<Response>(), second = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async id => {
    ++reads;
    return reads === 1 ? first.promise : reads === 2 ? second.promise : savedHistory(id, 'Recovered again');
  });
  await flush(); open('s1'); await flush(); chat.leave();
  const returning = chat.refreshAgents(); await flush();
  assert.equal(reads, 2);
  chat.leave(); second.resolve(savedHistory('s1', 'Cancelled recovery'));
  await returning; first.resolve(savedHistory('s1', 'Cancelled initial load')); await flush();
  assert.doesNotMatch(messages.textContent, /Cancelled recovery|Cancelled initial load/);
  await chat.refreshAgents(); await flush();
  assert.match(messages.textContent, /Recovered again/);
  assert.doesNotMatch(messages.textContent, /Loading…/);
});

test('T16 refreshing agents without leaving preserves the pending history request', { timeout: 2000 }, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async () => { ++reads; return pending.promise; });
  await flush(); open('s1'); await flush(); await chat.refreshAgents();
  assert.equal(reads, 1, 'agent refresh must not restart an uninterrupted load');
  pending.resolve(savedHistory('s1', 'Original history')); await flush();
  assert.match(messages.textContent, /Original history/);
  assert.doesNotMatch(messages.textContent, /Loading…/);
});

test('T16 leaving while the return refresh is pending defers recovery until the next return', { timeout: 2000 }, async t => {
  t.after(installDom());
  const pending = Promise.withResolvers<Response>(), commands = Promise.withResolvers<Response>();
  let reads = 0, delayCommands = false;
  const { chat, open, messages } = historySetup(
    async id => ++reads === 1 ? pending.promise : savedHistory(id, 'Next return history'),
    async () => delayCommands ? commands.promise : json({ commands: [] }),
  );
  await flush(); open('s1'); await flush(); chat.leave(); delayCommands = true;
  const returning = chat.refreshAgents(); await flush(); chat.leave();
  commands.resolve(json({ commands: [] })); await returning;
  assert.equal(reads, 1, 'a superseded return must not start a history load');
  pending.resolve(savedHistory('s1', 'Hidden old history')); await flush();
  assert.doesNotMatch(messages.textContent, /Hidden old history/);
  delayCommands = false; await chat.refreshAgents(); await flush();
  assert.match(messages.textContent, /Next return history/);
  assert.doesNotMatch(messages.textContent, /Loading…/);
});

// ---- turn persistence: stored notices and the live turn come back with the session
const said = (role: 'user' | 'assistant', text: string) => ({ role, content: [{ type: 'text', text }] });
const usedTool = (id: string, name: string) => ({ role: 'assistant', content: [{ type: 'tool_use', id, name, input: { path: 'a.txt' } }] });
const detail = (id: string, extra: Record<string, unknown>) => json({ id, agentId: 'a1', title: `Saved ${id}`, messages: [], notices: [], live: null, ...extra });
const kinds = (messages: TestNode) => messages.children.map(c => c.className.trim());
const bubbles = (messages: TestNode, role: string) => messages.querySelectorAll('.msg').filter(m => m.className.split(' ').includes(role));

test('run outcome note survives the session_updated reload', async t => {
  t.after(installDom());
  const reads: PromiseWithResolvers<Response>[] = [];
  const { chat, open, messages } = historySetup(() => { const read = Promise.withResolvers<Response>(); reads.push(read); return read.promise; });
  await flush(); open('s1'); reads[0]!.resolve(detail('s1', { messages: [said('user', 'hello?')] })); await flush();
  // The run fails: the daemon stores the note, then emits run_end, then session_updated; each makes the chat read the session again.
  chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  chat.onEvent({ type: 'run_end', sessionId: 's1', runId: 'r1', status: 'error', text: '', error: 'Provider HTTP 401: bad key' });
  chat.onEvent({ type: 'session_updated', sessionId: 's1' });
  assert.ok(reads.length >= 3, 'run_end and session_updated each reload');
  for (const read of reads.slice(1)) { // the answers arrive one after another, as over a real connection
    read.resolve(detail('s1', { messages: [said('user', 'hello?')], notices: [{ after: 1, level: 'error', text: 'Error: Provider HTTP 401: bad key', at: 2 }] }));
    await flush();
  }
  // the failure is one error card (plain cause first, the raw error behind Show details), and it is still there after every reload
  assert.equal(messages.querySelectorAll('.alert').length, 1);
  assert.equal(messages.querySelectorAll('.note').length, 0);
  assert.match(messages.querySelector('.alert-title')!.textContent, /cloud service refused the key/);
  assert.match(messages.querySelector('.alert')!.querySelector('pre')!.textContent, /Provider HTTP 401: bad key/);
  assert.equal(messages.querySelector('.alert')!.attrs.role, 'alert');
});

test('stored notices render in order after reopen', async t => {
  t.after(installDom());
  const { open, messages } = historySetup(async id => detail(id, {
    messages: [said('user', 'q1'), said('assistant', 'a1'), said('user', 'q2'), said('assistant', 'a2')],
    notices: [{ after: 2, level: 'info', text: 'Stopped.', at: 1 }, { after: 2, level: 'warn', text: 'Cut at max_tokens', at: 2 }, { after: 4, level: 'error', text: 'Error: later', at: 3 }],
  }));
  await flush(); open('s1'); await flush();
  assert.deepEqual(kinds(messages), ['msg user', 'msg assistant', 'note', 'note warn', 'msg user', 'msg assistant', 'alert']);
  assert.deepEqual(messages.querySelectorAll('.note').map(n => n.textContent), ['Stopped.', 'Cut at max_tokens']);
  assert.match(messages.querySelector('.alert')!.querySelector('pre')!.textContent, /later/);
});

test('switching chats keeps the live turn', async t => {
  t.after(installDom());
  const tool = (callId: string, extra = {}) => ({ callId, name: 'list_files', input: {}, done: false, ...extra });
  let s1: Record<string, unknown> = { messages: [said('user', 'MY QUESTION'), usedTool('c1', 'read_file'), usedTool('c2', 'list_files')], live: { runId: 'r1', text: 'half an ', tools: [tool('c2')] } };
  const { chat, open, messages } = historySetup(async id => id === 's1' ? detail(id, s1) : detail(id, { messages: [said('assistant', 'other chat')] }));
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); await flush();
  assert.match(messages.textContent, /MY QUESTION/);
  assert.equal(messages.querySelectorAll('.tool').length, 2);
  assert.equal(bubbles(messages, 'assistant').map(b => b.textContent).join('|'), 'half an ');
  // Away to another chat while the run goes on; the daemon moves on meanwhile.
  open('s2'); await flush();
  assert.match(messages.textContent, /other chat/); assert.doesNotMatch(messages.textContent, /MY QUESTION/);
  s1 = { messages: s1.messages, live: { runId: 'r1', text: 'half an answer', tools: [tool('c2', { done: true, isError: false, output: 'AAA' })] } };
  open('s1'); await flush();
  assert.match(messages.textContent, /MY QUESTION/);
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['half an answer']);
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['Running', 'Done']);
  // Later events update the same bubble and the same row.
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', text: ' continues' });
  chat.onEvent({ type: 'tool_end', sessionId: 's1', runId: 'r1', callId: 'c1', name: 'read_file', isError: false, output: 'BBB' });
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['half an answer continues']);
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['Done', 'Done']);
  assert.equal(messages.querySelectorAll('.tool').length, 2);
});

test('stream reconnect keeps the live turn', async t => {
  t.after(installDom());
  let live = { runId: 'r1', text: 'partial', tools: [] as unknown[] };
  const { chat, root, open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'MY QUESTION')], live }));
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); await flush();
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', text: ' more' });
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['partial more']);
  // The event stream drops and reconnects; the run went on meanwhile.
  live = { runId: 'r1', text: 'partial more and more', tools: [] };
  chat.onStreamOpen();
  chat.refresh();
  chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' }); // the replay of the active run
  for (let i = 0; i < 3; i++) await flush();
  assert.match(messages.textContent, /MY QUESTION/);
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['partial more and more']);
  assert.equal(root.querySelector('.send')!.textContent, 'Stop');
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', text: ' end' });
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['partial more and more end']);
});

test('events that arrive while the history loads are applied once, after the render', async t => {
  t.after(installDom());
  const first = Promise.withResolvers<Response>();
  let reads = 0;
  const { chat, open, messages } = historySetup(async id => ++reads === 1 ? first.promise : assert.fail('no second read'));
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); await flush();
  const delta = (seq: number, text: string) => chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', seq, text });
  // The daemon answered with the text up to event 1; events 1 and 2 reach the client before the answer does.
  delta(1, 'a'); delta(2, 'b');
  first.resolve(detail('s1', { messages: [said('user', 'q')], live: { runId: 'r1', seq: 1, text: 'a', tools: [] } }));
  for (let i = 0; i < 3; i++) await flush();
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['ab']); // 1 was in the answer, 2 was not: ABCD never becomes ABD or AABCD
  delta(2, 'b'); delta(3, 'c'); // a late copy of 2 is ignored
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['abc']);
  assert.equal(reads, 1);
});

test('a restore in the middle of a batch does not add a second row for the next tool', async t => {
  t.after(installDom());
  const batch = { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'list_files', input: {} }, { type: 'tool_use', id: 'c2', name: 'list_files', input: {} }] };
  const { chat, open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'q'), batch], live: { runId: 'r1', seq: 2, text: '', tools: [{ callId: 'c1', name: 'list_files', input: {}, done: false }] } }));
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); await flush();
  assert.equal(messages.querySelectorAll('.tool').length, 2);
  const end = (seq: number, callId: string) => chat.onEvent({ type: 'tool_end', sessionId: 's1', runId: 'r1', seq, callId, name: 'list_files', isError: false, output: 'ok' });
  end(3, 'c1');
  chat.onEvent({ type: 'tool_start', sessionId: 's1', runId: 'r1', seq: 4, callId: 'c2', name: 'list_files', input: {} });
  end(5, 'c2');
  assert.equal(messages.querySelectorAll('.tool').length, 2);
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['Done', 'Done']);
});

test('a tool call without a result is not shown as running when no run is going', async t => {
  t.after(installDom());
  let live: unknown = null;
  const { chat, open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'q'), usedTool('c1', 'write_file')], live }));
  await flush(); open('s1'); await flush(); // the daemon was killed mid-run: the call has no result and nothing is running
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => [s.className.trim(), s.textContent]), [['tool-status error', 'Failed']]);
  assert.match(messages.querySelector('.tool-out')!.textContent, /did not finish/);
  live = { runId: 'r1', seq: 1, text: '', tools: [] }; // while a run is going the same call really is running
  chat.refresh(); await flush();
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['Running']);
});

test('a run_end error is shown when the daemon could not store a note', async t => {
  t.after(installDom());
  const reads: PromiseWithResolvers<Response>[] = [];
  const { chat, open, messages } = historySetup(() => { const read = Promise.withResolvers<Response>(); reads.push(read); return read.promise; });
  await flush(); open('s1'); reads[0]!.resolve(detail('s1', { messages: [said('user', 'hello?')] })); await flush();
  chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  chat.onEvent({ type: 'run_end', sessionId: 's1', runId: 'r1', status: 'error', text: '', error: 'disk full' });
  chat.onEvent({ type: 'session_updated', sessionId: 's1' });
  for (const read of reads.slice(1)) { read.resolve(detail('s1', { messages: [said('user', 'hello?')], notices: [] })); await flush(); }
  assert.equal(messages.querySelectorAll('.alert').length, 1);
  assert.match(messages.querySelector('.alert')!.querySelector('pre')!.textContent, /disk full/);
  // The next run starts clean.
  chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r2' });
  chat.refresh(); await flush(); reads.at(-1)!.resolve(detail('s1', { messages: [said('user', 'again')], live: { runId: 'r2', seq: 0, text: '', tools: [] } })); await flush();
  assert.equal(messages.querySelectorAll('.note').length + messages.querySelectorAll('.alert').length, 0);
});

test('a finished call id that comes back in a later turn gets its own row', async t => {
  t.after(installDom());
  const finished = [usedTool('c1', 'read_file'), { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'first' }] }];
  const { chat, open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'q'), ...finished], live: { runId: 'r1', seq: 0, text: '', tools: [] } }));
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); await flush();
  chat.onEvent({ type: 'tool_start', sessionId: 's1', runId: 'r1', seq: 1, callId: 'c1', name: 'read_file', input: {} }); // a provider reusing the id
  assert.equal(messages.querySelectorAll('.tool').length, 2);
  chat.onEvent({ type: 'tool_end', sessionId: 's1', runId: 'r1', seq: 2, callId: 'c1', name: 'read_file', isError: false, output: 'second' });
  assert.deepEqual(messages.querySelectorAll('.tool-out').map(o => o.textContent), ['first', 'second']);
});

test('events held during a read that fails are still shown', async t => {
  t.after(installDom());
  const reads: PromiseWithResolvers<Response>[] = [];
  const { chat, open, messages } = historySetup(() => { const read = Promise.withResolvers<Response>(); reads.push(read); return read.promise; });
  await flush(); chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  open('s1'); reads[0]!.resolve(detail('s1', { messages: [said('user', 'q')], live: { runId: 'r1', seq: 1, text: 'A', tools: [] } })); await flush();
  const delta = (seq: number, text: string) => chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', seq, text });
  chat.refresh(); delta(2, 'B'); // held while the reload is in flight
  reads[1]!.resolve(json({ error: 'database is locked' }, 500)); await flush(); await flush();
  delta(3, 'C');
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['ABC']);
});

// ---- the simple shell: one send button, plain tool rows, approval and error cards, sidebar
type Call = { path: string; method?: string; body: any };
function harness(sessions: unknown[] = [], extra: (path: string) => Response | Promise<Response> | undefined = () => undefined) {
  const calls: Call[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push({ path, method: init?.method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const custom = extra(path);
    if (custom) return custom;
    if (path === '/api/agents') return json({ agents: [agent] });
    if (path === '/api/settings') return json({ config, secrets: {} });
    if (path === '/api/commands') return json({ commands: [] });
    if (path === '/api/sessions' && init?.method === 'POST') return json({ id: 's1' });
    if (path === '/api/sessions') return json({ sessions });
    if (path === '/api/sessions/s1/messages') return json({ runId: 'r1' }, 202);
    if (path.startsWith('/api/approvals/')) return json({ ok: true });
    if (path === '/api/sessions/s1') return detail('s1', {});
    assert.fail(`Unexpected request: ${path}`);
  }) as typeof fetch });
  const chat = createChat(api), root = chat.root as unknown as TestNode, sidebar = chat.sidebar as unknown as TestNode;
  const messages = root.querySelector('.messages')!, input = root.querySelector('textarea')!, send = root.querySelector('.send')!;
  const sent = (path: string) => calls.filter(c => c.path === path && c.method === 'POST');
  return { chat, root, sidebar, messages, input, send, calls, sent };
}
async function started(h: ReturnType<typeof harness>) { // a chat with one user message and a run in progress
  await flush(); h.input.value = 'build it'; h.send.fire('click'); await flush();
  h.chat.onEvent({ type: 'run_start', ...tag, sessionId: 's1' });
}
const run = { sessionId: 's1', runId: 'r1' };
const esc = () => ({ key: 'Escape', defaultPrevented: false, preventDefault() {} });

test('a new chat streams while an older read is pending', async t => {
  t.after(installDom());
  const old = Promise.withResolvers<Response>();
  const h = harness([{ id: 's2', agentId: 'a1', title: 'Saved s2', updatedAt: Date.now() }], path => path === '/api/sessions/s2' ? old.promise : undefined);
  await flush();
  h.sidebar.querySelector('.session')!.fire('click'); await flush(); // the read of s2 never answers
  h.chat.newChat();
  h.input.value = 'hello'; h.send.fire('click'); await flush(); // the daemon makes this new chat s1
  assert.equal(h.messages.querySelectorAll('.msg').length, 1);
  h.chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r1' });
  h.chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', seq: 1, text: 'streams' });
  assert.deepEqual(bubbles(h.messages, 'assistant').map(b => b.textContent), ['streams']);
  old.resolve(detail('s2', { messages: [said('assistant', 'the old read')] })); await flush();
  assert.deepEqual(bubbles(h.messages, 'assistant').map(b => b.textContent), ['streams'], 'the late read of the older chat is ignored');
});

test('a failed open does not replay held events onto the Loading screen', async t => {
  t.after(installDom());
  const read = Promise.withResolvers<Response>();
  const { chat, open, messages } = historySetup(() => read.promise);
  await flush(); open('s1'); await flush();
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', seq: 1, text: 'A' }); // held during the read
  read.resolve(json({ error: 'database is locked' }, 500)); await flush(); await flush();
  assert.match(messages.querySelector('.notice')!.textContent, /database is locked/);
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', seq: 2, text: 'B' });
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['B'], 'B is on screen, not in a bubble that was thrown away with the Loading screen');
});

test('a reused call id without a result is shown as interrupted, not as running', async t => {
  t.after(installDom());
  const result = { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'first' }] };
  const { open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'q'), usedTool('c1', 'read_file'), result, usedTool('c1', 'read_file')], live: null }));
  await flush(); open('s1'); await flush();
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['Done', 'Failed']);
});

test('the send button is Send or Stop, disabled when blank, and the composer waits for the connection', async t => {
  t.after(installDom());
  const h = harness();
  await flush();
  assert.equal(h.send.textContent, 'Send'); assert.equal(h.send.disabled, true, 'blank');
  h.input.value = 'hi'; h.input.fire('input'); assert.equal(h.send.disabled, false);
  h.chat.setOnline(false); assert.equal(h.send.disabled, true, 'reconnecting');
  h.chat.setOnline(true); assert.equal(h.send.disabled, false);
  assert.equal(h.root.querySelectorAll('.send').length, 1);
  h.input.value = ''; h.input.fire('input'); assert.equal(h.send.disabled, true);
});

test('the empty chat names the agent and model, and a starter fills the composer without sending', async t => {
  t.after(installDom());
  const h = harness();
  await flush();
  const empty = h.messages.querySelector('.empty')!;
  assert.match(empty.querySelector('p')!.textContent, /You're chatting with One on one-model\. It asks before it runs commands or changes files\./);
  assert.equal(empty.querySelector('img')!.attrs.src, 'icon-128.png');
  const chips = empty.querySelectorAll('.chip');
  assert.equal(chips.length, 3);
  assert.equal(chips[0]!.attrs.lang, 'th'); assert.equal(chips[2]!.attrs.lang, undefined);
  chips[2]!.fire('click');
  assert.equal(h.input.value, 'Plan my week');
  assert.equal(h.sent('/api/sessions/s1/messages').length, 0);
  assert.equal(h.send.disabled, false);
});

test('a run shows a streaming bubble from run_start; it goes away empty at the first tool and loses its caret at the end', async t => {
  t.after(installDom());
  const h = harness();
  await started(h);
  const streaming = () => h.messages.querySelectorAll('.msg').filter(m => m.className.split(' ').includes('streaming'));
  assert.equal(streaming().length, 1);
  assert.match(streaming()[0]!.textContent, /Thinking/);
  h.chat.onEvent({ type: 'tool_start', ...run, callId: 'c1', name: 'list_files', input: { path: '/Users/me/shop-site' } });
  assert.equal(streaming().length, 0); assert.equal(bubbles(h.messages, 'assistant').length, 0, 'no empty bubble is left behind');
  h.chat.onEvent({ type: 'tool_end', ...run, callId: 'c1', name: 'list_files', isError: false, output: 'a\nb\nc' });
  h.chat.onEvent({ type: 'text_delta', ...run, text: 'Done.' });
  assert.equal(streaming().length, 1); assert.equal(streaming()[0]!.textContent, 'Done.');
  h.chat.onEvent({ type: 'run_end', ...run, status: 'done', text: 'Done.' });
  assert.equal(streaming().length, 0);
  for (let i = 0; i < 3; i++) await flush();
});

test('a tool row is one plain sentence with an icon, a status word for screen readers, and opens itself on error', async t => {
  t.after(installDom());
  const h = harness();
  await started(h);
  h.chat.onEvent({ type: 'tool_start', ...run, callId: 'c1', name: 'list_files', input: { path: '/Users/me/shop-site/' } });
  assert.equal(h.messages.querySelector('.tool-name')!.textContent, 'Looking in shop-site…');
  h.chat.onEvent({ type: 'tool_end', ...run, callId: 'c1', name: 'list_files', isError: false, output: 'src\ntest\npackage.json\n' });
  assert.match(h.messages.querySelector('.tool-name')!.textContent, /^Looked at 3 items in shop-site$/);
  assert.equal(h.messages.querySelector('.tool-status')!.textContent, 'Done');
  assert.match(h.messages.querySelector('.tool-meta')!.textContent, /^\d+\.\d s$/);
  h.chat.onEvent({ type: 'tool_start', ...run, callId: 'c2', name: 'read_file', input: { path: 'package.json' } });
  h.chat.onEvent({ type: 'tool_end', ...run, callId: 'c2', name: 'read_file', isError: true, output: 'ENOENT' });
  const rows = h.messages.querySelectorAll('.tool') as unknown as (TestNode & { open?: boolean })[];
  assert.equal(rows[1]!.querySelector('.tool-name')!.textContent, "Couldn't read package.json");
  assert.equal(rows[1]!.open, true); assert.equal(rows[0]!.open, undefined);
  h.chat.onEvent({ type: 'tool_start', ...run, callId: 'c3', name: 'mcp__rea__open_binary', input: { path: '/tmp/target' } });
  assert.equal(h.messages.querySelectorAll('.tool-name')[2]!.textContent, 'mcp__rea__open_binary', 'an unknown tool keeps its raw id');
  assert.equal(h.messages.querySelector('.tool-arg')!.textContent, '/tmp/target');
});

test('an approval is Deny then Allow once; Esc denies; the running row hides while it waits; the receipt stays after the run', async t => {
  t.after(installDom());
  const h = harness([], path => path === '/api/sessions/s1' ? detail('s1', { messages: [said('user', 'build it'),
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'shell', input: { command: 'npm run build' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'c1', content: 'ok' }] }] }) : undefined);
  await started(h);
  h.chat.onEvent({ type: 'tool_start', ...run, callId: 'c1', name: 'shell', input: { command: 'npm run build' } });
  h.chat.onEvent({ type: 'approval_request', ...run, approvalId: 'a1', tool: 'shell', input: { command: 'npm run build' } });
  const card = h.messages.querySelector('.approval')!;
  const buttons = card.querySelector('.approval-actions')!.querySelectorAll('button');
  assert.deepEqual(buttons.map(b => b.textContent), ['Deny', 'Allow once']);
  assert.ok(buttons[0]!.className.includes('kbd-esc')); assert.equal(buttons[0]!.attrs['aria-keyshortcuts'], 'Escape');
  assert.ok(buttons[1]!.className.includes('primary'));
  assert.equal(card.querySelector('.approval-title')!.textContent, 'Run this command?');
  assert.match(card.querySelector('.approval-desc')!.textContent, /^BigNose wants to run it in work\. It can change files in that folder\.$/);
  assert.equal(card.querySelector('.approval-cmd')!.textContent, 'npm run build');
  assert.ok(card.querySelector('.approval-cmd')!.className.includes('command'));
  assert.doesNotMatch(card.textContent, /always allow/i); assert.equal(card.querySelector('.approval-icon'), null);
  assert.equal(card.attrs['aria-labelledby'], card.querySelector('.approval-title')!.attrs.id);
  const row = h.messages.querySelector('.tool')!;
  assert.equal(row.hidden, true, 'the card is that tool');
  h.chat.onKey(esc()); await flush();
  assert.deepEqual(h.sent('/api/approvals/a1').map(c => c.body), [{ allow: false }]);
  h.chat.onEvent({ type: 'approval_result', ...run, approvalId: 'a1', allowed: false });
  assert.equal(card.className, 'approval denied'); assert.match(card.textContent, /^You denied: npm run build$/);
  assert.equal(row.hidden, false);
  h.chat.onEvent({ type: 'approval_request', ...run, approvalId: 'a2', tool: 'web_fetch', input: { url: 'https://example.com/a' } });
  const second = h.messages.querySelectorAll('.approval')[1]!;
  assert.equal(second.querySelector('.approval-title')!.textContent, 'Open this web page?');
  second.querySelectorAll('button').find(b => b.textContent === 'Allow once')!.fire('click'); await flush();
  assert.deepEqual(h.sent('/api/approvals/a2').map(c => c.body), [{ allow: true }]);
  h.chat.onEvent({ type: 'approval_result', ...run, approvalId: 'a2', allowed: true });
  assert.equal(second.className, 'approval allowed'); assert.match(second.textContent, /^You allowed once: https:\/\/example\.com\/a$/);
  // the run ends and the chat is read again: both receipts are still there, and the first sits in front of the tool it was about
  h.chat.onEvent({ type: 'run_end', ...run, status: 'done', text: '' });
  for (let i = 0; i < 3; i++) await flush();
  const receipts = h.messages.querySelectorAll('.approval');
  assert.deepEqual(receipts.map(r => r.className), ['approval denied', 'approval allowed']);
  const order = h.messages.children.map(c => c.className.split(' ')[0]);
  assert.ok(order.indexOf('approval') < order.indexOf('tool'), 'the receipt reads before the result');
});

test('Esc leaves a card alone when the slash picker or another chat is in front, and never approves', async t => {
  t.after(installDom());
  const h = harness();
  await started(h);
  h.chat.onEvent({ type: 'approval_request', ...run, approvalId: 'a1', tool: 'shell', input: { command: 'ls' } });
  h.chat.onKey({ key: 'Enter', defaultPrevented: false, preventDefault() {} });
  h.chat.onKey({ key: 'Escape', defaultPrevented: true, preventDefault() {} }); // something else already used this Esc
  await flush();
  assert.equal(h.sent('/api/approvals/a1').length, 0);
  h.chat.onEvent({ type: 'approval_request', sessionId: 'other', runId: 'r2', approvalId: 'b1', tool: 'shell', input: { command: 'ls' } });
  h.chat.onKey(esc()); await flush();
  assert.deepEqual(h.calls.filter(c => c.path.startsWith('/api/approvals/')).map(c => c.path), ['/api/approvals/a1'], 'only this chat\'s card is denied');
});

test('an error card names the cause first, keeps the raw error behind Show details, and Try again only sits on the latest one', async t => {
  t.after(installDom());
  const notices = [
    { after: 1, level: 'error', text: 'Error: Provider HTTP 500: model runner has unexpectedly stopped', at: 1 },
    { after: 2, level: 'error', text: 'Error: connect ECONNREFUSED 127.0.0.1:11434', at: 2 },
    { after: 3, level: 'error', text: 'Error: Provider HTTP 404: model not found', at: 3 },
    { after: 4, level: 'error', text: 'Error: the disk is on fire\nsecond line', at: 4 },
  ];
  const h = harness([{ id: 's1', agentId: 'a1', title: 'Saved s1', updatedAt: Date.now() }],
    path => path === '/api/sessions/s1' ? detail('s1', { messages: [said('user', 'q1'), said('user', 'q2'), said('user', 'q3'), said('user', 'q4')], notices }) : undefined);
  await flush(); h.sidebar.querySelector('.session')!.fire('click'); await flush();
  const alerts = h.messages.querySelectorAll('.alert');
  assert.deepEqual(alerts.map(a => a.querySelector('.alert-title')!.textContent), ["The model didn't answer", "Ollama isn't running", "one-model isn't on this Mac", 'Something went wrong']);
  assert.match(alerts[0]!.querySelector('.alert-desc')!.textContent, /Ollama returned an error\. Make sure it is still running/);
  assert.match(alerts[2]!.querySelector('.alert-desc')!.textContent, /ollama pull one-model/);
  assert.equal(alerts[3]!.querySelector('.alert-desc')!.textContent, 'the disk is on fire');
  assert.deepEqual(alerts.map(a => a.querySelectorAll('button').some(b => b.textContent === 'Try again')), [false, false, false, true]);
  const details = alerts[0]!.querySelector('.alert-more')!, toggle = alerts[0]!.querySelectorAll('button').find(b => b.textContent === 'Show details')!;
  assert.equal(details.hidden, true); assert.equal(toggle.attrs['aria-expanded'], 'false');
  toggle.fire('click');
  assert.equal(details.hidden, false); assert.equal(toggle.attrs['aria-expanded'], 'true'); assert.equal(toggle.textContent, 'Hide details');
  assert.match(details.querySelector('pre')!.textContent, /Provider HTTP 500: model runner has unexpectedly stopped\none-model · http:\/\/127\.0\.0\.1:1\/v1 · /);
  alerts[3]!.querySelectorAll('button').find(b => b.textContent === 'Try again')!.fire('click'); await flush();
  assert.deepEqual(h.sent('/api/sessions/s1/messages').map(c => c.body), [{ text: 'q4' }], 'it sends the last user message again');
});

test('the sidebar groups chats by day, shows Waiting and Running, and keeps search for long lists or Cmd+F', async t => {
  t.after(installDom());
  const day = 86_400_000, now = Date.now();
  const list = [
    { id: 's1', agentId: 'a1', title: 'Today chat', updatedAt: now },
    { id: 's2', agentId: 'a1', title: 'เมื่อวานนี้', updatedAt: now - day },
    { id: 's3', agentId: 'a1', title: 'Last month', updatedAt: now - 30 * day },
  ];
  const h = harness(list);
  await flush();
  assert.deepEqual(h.sidebar.querySelectorAll('.session-group').map(g => g.textContent), ['Today', 'Yesterday', 'Older']);
  assert.deepEqual(h.sidebar.querySelectorAll('.session-title').map(g => g.attrs.lang), [undefined, 'th', undefined]);
  const search = h.sidebar.querySelector('input')!;
  assert.equal(search.hidden, true);
  h.chat.focusSearch(); assert.equal(search.hidden, false);
  h.chat.onEvent({ type: 'run_start', sessionId: 's3', runId: 'r3' });
  h.chat.onEvent({ type: 'approval_request', sessionId: 's2', runId: 'r2', approvalId: 'b1', tool: 'shell', input: {} });
  const rows = h.sidebar.querySelectorAll('.session-item');
  assert.match(rows[2]!.textContent, /Last monthRunning/); assert.ok(rows[2]!.querySelector('.dot'));
  assert.match(rows[1]!.textContent, /Waiting/); assert.ok(rows[1]!.querySelector('.badge'));
  assert.equal(rows[0]!.querySelector('.badge'), null);
  assert.equal(h.sidebar.querySelectorAll('.session').find(b => b.textContent.includes('Today chat'))!.attrs['aria-current'], undefined);
  h.sidebar.querySelector('.session')!.fire('click'); await flush();
  assert.equal(h.sidebar.querySelector('.session')!.attrs['aria-current'], 'true');
  assert.equal(h.chat.isEmpty(), false);
  h.chat.newChat(); assert.equal(h.chat.isEmpty(), true);
});

test('with more than eight chats the search row shows by itself', async t => {
  t.after(installDom());
  const list = Array.from({ length: 9 }, (_, i) => ({ id: `s${i + 1}`, agentId: 'a1', title: `Chat ${i + 1}`, updatedAt: Date.now() }));
  const h = harness(list);
  await flush();
  assert.equal(h.sidebar.querySelector('input')!.hidden, false);
});
