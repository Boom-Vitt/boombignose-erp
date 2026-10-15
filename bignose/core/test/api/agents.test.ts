import test from 'node:test';
import assert from 'node:assert/strict';
import { startDaemon } from '../../src/app/daemon.ts';
import { loadConfig } from '../../src/config.ts';
import { configured, testHome } from '../e2e/helpers.ts';
import type { Agent, Provider } from '../../src/types.ts';

type App = Awaited<ReturnType<typeof startDaemon>>;
async function call(a: App, path: string, method = 'GET', value?: unknown) {
  const res = await fetch(`http://127.0.0.1:${a.port}${path}`, { method, headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: value === undefined ? undefined : JSON.stringify(value) });
  return { status: res.status, body: await res.json() as any };
}

test('agents CRUD/defaults, all agent-scoped routes, LINE validation/clearing, and persistence across daemon restart', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.agent.systemPrompt = 'Initial instructions'; });
  const a = await startDaemon({ home }); t.after(() => a.close());
  const first: Agent = (await call(a, '/api/agents')).body.agents[0];
  assert.equal(first.name, 'BigNose'); assert.equal(first.instructions, 'Initial instructions');
  assert.equal(first.provider, 'mock'); assert.equal(first.model, 'test-model');
  assert.equal((await call(a, `/api/agents/${first.id}`)).status, 200);
  const created = await call(a, '/api/agents', 'POST', { name: '  Research  ' });
  assert.equal(created.status, 201);
  const second: Agent = created.body;
  assert.equal(second.name, 'Research'); assert.equal(second.icon, '🤖'); assert.equal(second.instructions, '');
  assert.deepEqual(second.permissions, {}); assert.equal(second.connectors, null); assert.equal(second.skills, null);
  const patch = { name: 'Two', icon: '🔎', instructions: 'Cite evidence', provider: 'mock', model: 'other-model', permissions: { shell: 'deny' }, connectors: ['rea', 'unknown'], skills: ['research', 'unknown'] };
  const updated = await call(a, `/api/agents/${second.id}`, 'PATCH', patch);
  assert.equal(updated.status, 200);
  for (const [k, v] of Object.entries(patch)) assert.deepEqual(updated.body[k], v);
  assert.ok(updated.body.createdAt > 1e12); assert.ok(updated.body.updatedAt >= updated.body.createdAt);
  const one = (await call(a, '/api/sessions', 'POST', {})).body.id;
  const two = (await call(a, '/api/sessions', 'POST', { agentId: second.id, title: 'Two session' })).body.id;
  for (const id of [one, two]) a.runtime.store.appendMessages(id, [{ role: 'user', content: [{ type: 'text', text: 'needle ไป' }] }]);
  assert.equal((await call(a, `/api/sessions/${one}`)).body.agentId, first.id);
  assert.equal((await call(a, `/api/sessions/${two}`)).body.agentId, second.id);
  assert.equal((await call(a, '/api/sessions')).body.sessions.length, 2);
  for (const q of ['', '&q=needle', '&q=' + encodeURIComponent('ไป')]) {
    const scoped = await call(a, `/api/sessions?agent=${second.id}${q}`);
    assert.deepEqual(scoped.body.sessions.map((s: any) => s.id), [two]);
    assert.equal(scoped.body.sessions[0].agentId, second.id);
  }
  const shared = (await call(a, '/api/memory', 'POST', { kind: 'user', text: 'needle shared', agentId: second.id })).body;
  const own = (await call(a, '/api/memory', 'POST', { kind: 'agent', text: 'needle own', agentId: second.id })).body;
  const other = (await call(a, '/api/memory', 'POST', { kind: 'agent', text: 'needle first', agentId: first.id })).body;
  assert.equal(shared.agentId, null); assert.equal(own.agentId, second.id);
  for (const q of ['', '&q=needle']) {
    assert.deepEqual(new Set((await call(a, `/api/memory?agent=${second.id}${q}`)).body.notes.map((n: any) => n.id)), new Set([shared.id, own.id]));
    assert.deepEqual((await call(a, `/api/memory?agent=${second.id}&kind=agent${q}`)).body.notes.map((n: any) => n.id), [own.id]);
  }
  const jobInput = { cron: '0 9 * * *', prompt: 'task', delivery: { kind: 'desktop' } };
  const jobOne = (await call(a, '/api/schedules', 'POST', jobInput)).body;
  const jobTwo = (await call(a, '/api/schedules', 'POST', { ...jobInput, agentId: second.id })).body;
  assert.equal(jobOne.agentId, first.id); assert.equal(jobTwo.agentId, second.id);
  assert.deepEqual((await call(a, `/api/schedules?agent=${second.id}`)).body.jobs.map((j: any) => j.id), [jobTwo.id]);
  assert.ok((await call(a, '/api/schedules')).body.jobs[0].nextRunAt > 1e12);
  const settings = (await call(a, '/api/settings')).body;
  settings.config.line.agentId = 'missing'; assert.equal((await call(a, '/api/settings', 'PUT', settings)).status, 400);
  settings.config.line.agentId = second.id; assert.equal((await call(a, '/api/settings', 'PUT', settings)).status, 200);
  assert.equal((await call(a, '/api/line/status')).body.agentId, second.id);
  await a.close();
  const restarted = await startDaemon({ home }); t.after(() => restarted.close());
  assert.equal((await call(restarted, '/api/agents')).body.agents.length, 2);
  assert.deepEqual((await call(restarted, `/api/agents/${second.id}`)).body, updated.body);
  assert.equal((await call(restarted, `/api/sessions/${two}`)).body.messages.length, 1);
  assert.equal((await call(restarted, '/api/line/status')).body.agentId, second.id);
  assert.equal((await call(restarted, `/api/agents/${second.id}`, 'DELETE')).status, 200);
  assert.equal(loadConfig(home).line.agentId, undefined);
  assert.equal((await call(restarted, '/api/line/status')).body.agentId, first.id);
  assert.equal((await call(restarted, `/api/sessions/${two}`)).status, 404);
  assert.deepEqual(restarted.runtime.store.getMessages(two), []);
  assert.equal((await call(restarted, '/api/sessions?q=needle')).body.sessions.length, 1);
  assert.deepEqual(new Set((await call(restarted, '/api/memory')).body.notes.map((n: any) => n.id)), new Set([shared.id, other.id]));
  assert.deepEqual((await call(restarted, '/api/schedules')).body.jobs.map((j: any) => j.id), [jobOne.id]);
  assert.equal((await call(restarted, `/api/agents/${first.id}`, 'DELETE')).status, 409);
  assert.equal((await call(restarted, '/api/agents')).body.agents.length, 1);
});

test('agents and agent ownership reject invalid input with 400 and unknown resources with 404', async t => {
  const home = testHome(t); configured(home);
  const a = await startDaemon({ home }); t.after(() => a.close());
  const id = a.runtime.store.listAgents()[0]!.id;
  for (const value of [{}, { name: '' }, { name: '  ' }, { name: 'x'.repeat(65) }, { name: 123 }, { name: 'ok', icon: '' },
    { name: 'ok', icon: 'x'.repeat(17) }, { name: 'ok', icon: null }, { name: 'ok', instructions: 1 }, { name: 'ok', provider: 'unknown' },
    { name: 'ok', model: '  ' }, { name: 'ok', model: 1 }, { name: 'ok', permissions: { shell: 'wrong' } }, { name: 'ok', permissions: [] },
    { name: 'ok', connectors: 'rea' }, { name: 'ok', connectors: [1] }, { name: 'ok', skills: {} }, { name: 'ok', skills: [''] }, { name: 'ok', id: 'new-id' }]) {
    assert.equal((await call(a, '/api/agents', 'POST', value)).status, 400, JSON.stringify(value));
    if ('name' in value) assert.equal((await call(a, `/api/agents/${id}`, 'PATCH', value)).status, 400, JSON.stringify(value));
  }
  assert.equal((await call(a, `/api/agents/${id}`, 'PATCH', {})).status, 200);
  assert.equal((await call(a, '/api/agents', 'POST', { name: 'x'.repeat(64), icon: 'x'.repeat(16), connectors: [], skills: null })).status, 201);
  for (const method of ['GET', 'PATCH', 'DELETE']) assert.equal((await call(a, '/api/agents/unknown', method, method === 'PATCH' ? { name: 'ok' } : undefined)).status, 404);
  for (const agentId of ['missing', null, 1, '']) {
    assert.equal((await call(a, '/api/sessions', 'POST', { agentId })).status, 400);
    assert.equal((await call(a, '/api/memory', 'POST', { kind: 'agent', text: 'note', agentId })).status, 400);
    assert.equal((await call(a, '/api/schedules', 'POST', { cron: '* * * * *', prompt: 'task', delivery: { kind: 'desktop' }, agentId })).status, 400);
  }
  assert.equal((await call(a, '/api/memory', 'POST', { kind: 'agent', text: 'note' })).status, 400);
  const config = a.config(); config.line.agentId = null as any;
  assert.equal((await call(a, '/api/settings', 'PUT', { config })).status, 400);
});

test('deleting an agent interrupts its active run before removing its transcript and approvals', async t => {
  const home = testHome(t); configured(home);
  const provider: Provider = { kind: 'openai-compatible', async *stream() {
    yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: 'output.txt', content: 'hello' } };
    yield { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 0, outputTokens: 0 } };
  } };
  const a = await startDaemon({ home, providerFactory: () => provider }); t.after(() => a.close());
  const agent = a.runtime.store.createAgent({ name: 'Temporary', ...a.config().active });
  const session = a.runtime.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
  const run = a.runtime.start(session.id, 'write');
  const deadline = Date.now() + 30_000;
  while (!a.runtime.pendingEvents().length) { assert.ok(Date.now() < deadline); await new Promise(resolve => setImmediate(resolve)); }
  assert.equal((await call(a, `/api/agents/${agent.id}`, 'DELETE')).status, 200);
  assert.equal((await run.result).status, 'interrupted'); assert.equal(a.runtime.pendingEvents().length, 0);
  assert.equal(a.runtime.store.getSession(session.id), undefined); assert.deepEqual(a.runtime.store.getMessages(session.id), []);
});

test('changing or deleting the chosen LINE agent preserves the webhook listener', async t => {
  const home = testHome(t); configured(home, undefined, c => { c.line.enabled = true; });
  const { setSecret } = await import('../../src/config.ts');
  setSecret('LINE_CHANNEL_ACCESS_TOKEN', 'test-token', home); setSecret('LINE_CHANNEL_SECRET', 'test-secret', home);
  const a = await startDaemon({ home }); t.after(() => a.close());
  const second = a.runtime.store.createAgent({ name: 'LINE agent', provider: 'mock', model: 'test-model' });
  const config = a.config();
  // A settings call also waits for the initial listener startup.
  await call(a, '/api/settings', 'PUT', { config });
  const port = a.lineStatus().port; assert.ok(port > 0);
  config.line.agentId = second.id;
  assert.equal((await call(a, '/api/settings', 'PUT', { config })).status, 200);
  assert.equal(a.lineStatus().agentId, second.id); assert.equal(a.lineStatus().port, port);
  assert.equal((await call(a, `/api/agents/${second.id}`, 'DELETE')).status, 200);
  assert.equal(a.lineStatus().port, port); assert.equal(a.lineStatus().running, true);
});
