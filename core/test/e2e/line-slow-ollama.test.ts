import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { startDaemon } from '../../src/app/daemon.ts';
import { setSecret } from '../../src/config.ts';
import { configured, mockOpenai, testHome } from './helpers.ts';

const until = async (read: () => unknown) => {
  const deadline = Date.now() + 5000;
  while (!read()) { assert.ok(Date.now() < deadline, 'timed out'); await new Promise(resolve => setTimeout(resolve, 5)); }
};

test('LINE webhook → daemon → slow mock Ollama → Get answer → postback delivers the cached answer', async t => {
  const home = testHome(t), answer = Promise.withResolvers<void>();
  const mock = await mockOpenai(t, async req => {
    assert.equal(req.model, 'slow-model'); assert.equal(req.max_tokens, 512);
    await answer.promise; return { content: 'Slow local answer.' };
  });
  t.after(() => answer.resolve());
  configured(home, mock.baseUrl, c => {
    c.providers[0]!.id = 'ollama'; c.providers[0]!.apiKeyEnv = 'OLLAMA_API_KEY';
    c.active = { provider: 'ollama', model: 'slow-model' };
    c.line.enabled = true; c.line.allow.users = ['Uowner']; c.line.slowResponseMs = 30;
  });
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  const replies: any[] = [];
  const app = await startDaemon({ home, lineOptions: { apiBase: 'http://127.0.0.1:1', fetchImpl: async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v2/bot/message/reply') replies.push(JSON.parse(String(init!.body)));
    else assert.equal(path, '/v2/bot/chat/loading/start');
    return Response.json({});
  } } }); t.after(() => app.close());
  app.runtime.store.updateAgent(app.runtime.store.listAgents()[0]!.id, { maxTokens: 512 });
  await until(() => app.lineStatus().running);
  let sequence = 0;
  const post = async (event: Record<string, unknown>) => {
    const raw = JSON.stringify({ events: [{ ...event, webhookEventId: `event-${++sequence}`, source: { type: 'user', userId: 'Uowner' } }] });
    const res = await fetch(`http://127.0.0.1:${app.lineStatus().port}/line/webhook`, { method: 'POST', body: raw,
      headers: { 'X-Line-Signature': createHmac('sha256', 'test-secret').update(raw).digest('base64') } });
    assert.equal(res.status, 200); await res.text();
  };
  await post({ type: 'message', replyToken: 'initial', message: { type: 'text', text: 'hello slowly' } });
  await until(() => replies.length === 1);
  const action = replies[0].messages[0].template.actions[0];
  assert.equal(action.label, 'Get answer'); assert.match(action.data, /^get:/); assert.equal(replies[0].replyToken, 'initial');
  answer.resolve();
  await until(() => app.runtime.store.listSessions().some(s => !app.runtime.isRunning(s.id) && app.runtime.store.getSession(s.id)!.context.some(m => m.content.some(b => b.type === 'text' && b.text === 'Slow local answer.'))));
  await post({ type: 'postback', replyToken: 'fresh', postback: { data: action.data } });
  await until(() => replies.length === 2);
  assert.deepEqual(replies[1], { replyToken: 'fresh', messages: [{ type: 'text', text: 'Slow local answer.' }] });
  assert.equal(mock.requests.length, 1);
});
