import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startDaemon } from '../../core/src/app/daemon.ts';
import { configured, testHome } from '../../core/test/e2e/helpers.ts';
import { OLLAMA_CONTEXT_NOTE } from '../../core/src/providers/ollama.ts';
import { createApi } from '../src/api.ts';
import { openUi, until } from './cdp.ts';

test('built UI creates an agent on an unlisted Ollama model, chats with its token limit, and shows context advice', { timeout: 120_000 }, async t => {
  const home = testHome(t), requests: { body: any; auth?: string }[] = [];
  const mock = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'mock:one' }, { id: 'mock:two' }] })); return; }
    if (req.url === '/api/ps') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ models: [{ name: 'mock:one', context_length: 4096 }] })); return; }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push({ body: JSON.parse(raw), auth: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.end('data: {"choices":[{"delta":{"content":"Mock Ollama reply."},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise<void>(resolve => mock.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { mock.close(() => resolve()); mock.closeAllConnections(); }));
  configured(home, `http://127.0.0.1:${(mock.address() as { port: number }).port}/v1`, c => {
    c.providers[0]!.id = 'ollama'; c.providers[0]!.apiKeyEnv = 'OLLAMA_API_KEY'; c.providers[0]!.contextWindow = 32768;
    c.active = { provider: 'ollama', model: 'mock:one' };
  });
  const app = await startDaemon({ home }); t.after(() => app.close());
  const api = createApi({ port: app.port, token: app.token });
  const ui = await openUi(t, app);
  await ui.click('Agents'); await ui.click('New agent');
  await ui.wait(`document.querySelector('.agent-form datalist')?.options.length===2`);
  assert.deepEqual(await ui.cdp.evaluate(`Array.from(document.querySelector('.agent-form datalist').options).map(o=>o.value)`), ['mock:one', 'mock:two']);
  await ui.field('Name', 'Any model', "document.querySelector('.agent-form')");
  // a model nobody lists: Other… shows the typed name
  await ui.cdp.evaluate(`(()=>{const s=document.querySelector('.agent-form .card select');s.value='other';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  await ui.field('Model name', 'typed/not-in-list', "document.querySelector('.agent-form')");
  await ui.cdp.evaluate(`document.querySelector('.agent-form details').open=true`);
  await ui.field('Longest answer', '512', "document.querySelector('.agent-form')");
  await ui.click('Create agent', "document.querySelector('.agent-form')");
  const agent = await until(async () => (await api.listAgents()).agents.find(a => a.name === 'Any model'), 'agent persisted');
  assert.equal(agent.model, 'typed/not-in-list'); assert.equal(agent.maxTokens, 512); assert.ok(!Object.hasOwn(agent, 'effort'));
  await ui.click('Chat', `document.querySelector('[data-agent-id="${agent.id}"]')`);
  await ui.wait(`document.querySelector('[aria-label="Chat agent"]')?.value===${JSON.stringify(agent.id)}`);
  await ui.fill('[aria-label="Message"]', 'Hello local model'); await ui.click('Send');
  await ui.wait(`document.querySelector('.messages').textContent.includes('Mock Ollama reply.')`);
  assert.equal(requests.length, 1); assert.equal(requests[0]!.body.model, 'typed/not-in-list');
  assert.equal(requests[0]!.body.max_tokens, 512); assert.equal(requests[0]!.auth, undefined);
  await ui.click('Providers & models');
  await ui.wait(`document.querySelector('[aria-label="Settings"]').textContent.includes('4096-token context')`);
  assert.ok(await ui.cdp.evaluate(`document.querySelector('[aria-label="Settings"]').textContent.includes(${JSON.stringify(OLLAMA_CONTEXT_NOTE)})`));
  assert.ok(await ui.cdp.evaluate(`document.querySelector('[aria-label="Settings"]').textContent.includes('API key (optional):')`));
  await ui.wait(`document.querySelector('#provider-models')?.options.length===2`);
  assert.deepEqual(ui.cdp.errors, []);
});
