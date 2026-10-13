import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { createChat } from '../src/chat.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';

const tag = { sessionId: 's1', runId: 'r1' };

function setup(post: () => Promise<Response>) {
  let history = () => Promise.resolve(json({ id: 's1', title: '', messages: [] }));
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
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
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(send.hidden, false);
  assert.equal(stop.hidden, true);
  assert.equal(input.value, 'hello');
});

test('a 409 keeps Stop available for the run already active on the daemon', async (t) => {
  t.after(installDom());
  const { input, send, stop } = setup(async () => json({ error: 'Already active' }, 409));
  input.value = 'hello'; send.fire('click');
  await flush();
  assert.equal(stop.hidden, false);
  assert.equal(send.hidden, true);
  assert.equal(input.value, 'hello');
});

test('stream reset removes stale approvals and a slow refresh preserves replayed state', async (t) => {
  t.after(installDom());
  const { chat, root, input, send, stop, delayHistory } = setup(async () => json({ runId: 'r1' }, 202));
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
