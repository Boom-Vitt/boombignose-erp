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
  const chat = createChat(api), root = chat.root as unknown as TestNode;
  const open = (id: string) => root.querySelectorAll('.session').find(b => b.textContent.startsWith(`Saved ${id}`))!.fire('click');
  return { chat, root, open, messages: root.querySelector('.messages')! };
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
  const { chat, root, open, messages } = historySetup(async id => {
    if (id === 's1') return old.promise;
    return ++reads === 1 ? current.promise : savedHistory(id, 'Current session');
  });
  await flush(); open('s1'); await flush(); open('s2'); await flush(); chat.leave();
  await chat.refreshAgents(); await flush();
  assert.match(messages.textContent, /Current session/);
  assert.match(root.querySelector('.active')!.textContent, /Saved s2/);
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
  assert.deepEqual(messages.querySelectorAll('.note').map(n => [n.className.trim(), n.textContent]), [['note error', 'Error: Provider HTTP 401: bad key']]);
});

test('stored notices render in order after reopen', async t => {
  t.after(installDom());
  const { open, messages } = historySetup(async id => detail(id, {
    messages: [said('user', 'q1'), said('assistant', 'a1'), said('user', 'q2'), said('assistant', 'a2')],
    notices: [{ after: 2, level: 'info', text: 'Stopped.', at: 1 }, { after: 2, level: 'warn', text: 'Cut at max_tokens', at: 2 }, { after: 4, level: 'error', text: 'Error: later', at: 3 }],
  }));
  await flush(); open('s1'); await flush();
  assert.deepEqual(kinds(messages), ['msg user', 'msg assistant', 'note', 'note warn', 'msg user', 'msg assistant', 'note error']);
  assert.deepEqual(messages.querySelectorAll('.note').map(n => n.textContent), ['Stopped.', 'Cut at max_tokens', 'Error: later']);
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
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['running', 'done']);
  // Later events update the same bubble and the same row.
  chat.onEvent({ type: 'text_delta', sessionId: 's1', runId: 'r1', text: ' continues' });
  chat.onEvent({ type: 'tool_end', sessionId: 's1', runId: 'r1', callId: 'c1', name: 'read_file', isError: false, output: 'BBB' });
  assert.deepEqual(bubbles(messages, 'assistant').map(b => b.textContent), ['half an answer continues']);
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['done', 'done']);
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
  assert.equal(root.querySelectorAll('button').find(b => b.textContent === 'Stop')!.hidden, false);
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
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['done', 'done']);
});

test('a tool call without a result is not shown as running when no run is going', async t => {
  t.after(installDom());
  let live: unknown = null;
  const { chat, open, messages } = historySetup(async id => detail(id, { messages: [said('user', 'q'), usedTool('c1', 'write_file')], live }));
  await flush(); open('s1'); await flush(); // the daemon was killed mid-run: the call has no result and nothing is running
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => [s.className.trim(), s.textContent]), [['tool-status error', 'error']]);
  assert.match(messages.querySelector('.tool-out')!.textContent, /did not finish/);
  live = { runId: 'r1', seq: 1, text: '', tools: [] }; // while a run is going the same call really is running
  chat.refresh(); await flush();
  assert.deepEqual(messages.querySelectorAll('.tool-status').map(s => s.textContent), ['running']);
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
  assert.deepEqual(messages.querySelectorAll('.note').map(n => [n.className.trim(), n.textContent]), [['note error', 'Error: disk full']]);
  // The next run starts clean.
  chat.onEvent({ type: 'run_start', sessionId: 's1', runId: 'r2' });
  chat.refresh(); await flush(); reads.at(-1)!.resolve(detail('s1', { messages: [said('user', 'again')], live: { runId: 'r2', seq: 0, text: '', tools: [] } })); await flush();
  assert.equal(messages.querySelectorAll('.note').length, 0);
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
