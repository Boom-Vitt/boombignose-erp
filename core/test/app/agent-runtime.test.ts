import test from 'node:test';
import assert from 'node:assert/strict';
import type { TestContext } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Runtime } from '../../src/app/runtime.ts';
import type { RuntimeOptions } from '../../src/app/runtime.ts';
import { openStore } from '../../src/store/index.ts';
import { Scheduler, scheduleTools } from '../../src/cron/index.ts';
import { McpManager } from '../../src/mcp/manager.ts';
import { paths, readEnv, setSecret, maskSecret } from '../../src/config.ts';
import { saveSkill } from '../../src/skills/index.ts';
import { configured, testHome } from '../e2e/helpers.ts';
import type { Config, Provider, ProviderRequest, ToolResultBlock } from '../../src/types.ts';

async function harness(t: TestContext, factory: NonNullable<RuntimeOptions['providerFactory']>, change?: (c: Config) => void) {
  const home = testHome(t), config = configured(home, undefined, change), store = openStore(join(home, 'store.db'));
  const mcp = new McpManager(config.mcp.servers, readEnv(home));
  let runtime: Runtime;
  const scheduler = new Scheduler({ store, onFire: job => runtime.fireJob(job) });
  runtime = new Runtime({ home, store, mcp, scheduler, config: () => config, line: () => undefined, providerFactory: factory });
  t.after(async () => { scheduler.stop(); await runtime.close(); await mcp.stop(); store.close(); });
  await mcp.start();
  return { home, config, store, runtime, scheduler };
}
const done = { type: 'done' as const, stopReason: 'end_turn' as const, usage: { inputTokens: 0, outputTokens: 0 } };
const results = (request: ProviderRequest) => request.messages.flatMap(m => m.content).filter((b): b is ToolResultBlock => b.type === 'tool_result');
const fakeMcp = { transport: 'stdio' as const, command: process.execPath, args: [fileURLToPath(new URL('../mcp/fake-server.ts', import.meta.url))], enabled: true, tools: ['echo'] };

test('each agent uses its provider/key/model/instructions/permissions, own notes/search/skills/connectors and shared user memory', async t => {
  const requests: { provider: string; key?: string; req: ProviderRequest }[] = [];
  let otherNote = 0;
  const h = await harness(t, (config, key) => ({ kind: 'openai-compatible', async *stream(req) {
    requests.push({ provider: config.id, key, req });
    if (req.messages.length === 1) {
      yield { type: 'tool_call', id: 'read', name: 'memory_read', input: {} };
      yield { type: 'tool_call', id: 'search', name: 'session_search', input: { query: 'needle' } };
      yield { type: 'tool_call', id: 'foreign-note', name: 'memory_write', input: { action: 'update', id: otherNote, text: 'overwrite' } };
      yield { type: 'tool_call', id: 'own-skill', name: 'skill_load', input: { name: config.id === 'mock' ? 'alpha' : 'beta' } };
      yield { type: 'tool_call', id: 'foreign-skill', name: 'skill_load', input: { name: config.id === 'mock' ? 'beta' : 'alpha' } };
      yield { type: 'tool_call', id: 'save-foreign-skill', name: 'skill_save', input: { name: config.id === 'mock' ? 'beta' : 'alpha', description: 'new', body: 'overwrite' } };
      yield { type: 'tool_call', id: 'write', name: 'write_file', input: { path: config.id + '.txt', content: config.id } };
      yield { type: 'tool_call', id: 'schedule', name: 'schedule_create', input: { cron: '0 9 * * *', prompt: config.id } };
    } else yield { type: 'text_delta', text: 'done' };
    yield done;
  } }), c => {
    c.providers.push({ id: 'second', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', apiKeyEnv: 'SECOND_KEY' });
    c.providers[0]!.apiKeyEnv = 'FIRST_KEY';
    c.permissions.write_file = 'deny'; c.permissions.schedule_create = 'allow'; c.permissions.skill_save = 'allow';
    c.mcp.servers.alpha = fakeMcp; c.mcp.servers.beta = fakeMcp;
    c.mcp.servers.disabled = { ...fakeMcp, enabled: false };
  });
  setSecret('FIRST_KEY', 'first-fake', h.home); setSecret('SECOND_KEY', 'second-fake', h.home);
  saveSkill(paths(h.home).skills, { name: 'alpha', description: 'alpha skill', body: 'Alpha procedure' });
  saveSkill(paths(h.home).skills, { name: 'beta', description: 'beta skill', body: 'Beta procedure' });
  const first = h.store.listAgents()[0]!;
  h.store.updateAgent(first.id, { instructions: 'Alpha instructions', model: 'alpha-model', permissions: { write_file: 'allow' }, connectors: ['alpha', 'disabled', 'missing'], skills: ['alpha', 'missing'] });
  const second = h.store.createAgent({ name: 'Beta', provider: 'second', model: 'beta-model', instructions: 'Beta instructions', permissions: { write_file: 'deny' }, connectors: ['beta'], skills: ['beta'] });
  h.store.addMemory('user', 'Shared user fact');
  const aNote = h.store.addMemory('agent', 'Alpha private note', first.id), bNote = h.store.addMemory('agent', 'Beta private note', second.id);
  for (const agentId of [first.id, second.id]) {
    const past = h.store.createSession({ origin: { kind: 'desktop' }, agentId });
    h.store.appendMessages(past.id, [{ role: 'user', content: [{ type: 'text', text: `needle ${agentId}` }] }]);
  }
  for (const [agent, label, foreignLabel] of [[h.store.getAgent(first.id)!, 'Alpha', 'Beta'], [second, 'Beta', 'Alpha']] as const) {
    otherNote = label === 'Alpha' ? bNote.id : aNote.id;
    const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
    assert.equal((await h.runtime.start(session.id, 'work').result).status, 'done');
    const request = requests.filter(r => r.provider === agent.provider)[0]!;
    assert.equal(request.req.model, agent.model); assert.equal(request.key, label === 'Alpha' ? 'first-fake' : 'second-fake');
    assert.match(request.req.system, new RegExp(`${label} instructions`)); assert.match(request.req.system, /Shared user fact/);
    assert.match(request.req.system, new RegExp(`${label} private note`)); assert.doesNotMatch(request.req.system, new RegExp(`${foreignLabel} private note`));
    assert.match(request.req.system, new RegExp(`- ${label.toLowerCase()}:`)); assert.doesNotMatch(request.req.system, new RegExp(`- ${foreignLabel.toLowerCase()}:`));
    assert.doesNotMatch(request.req.system, /missing/); assert.match(request.req.system, /Today: \d{4}-\d{2}-\d{2}/);
    assert.deepEqual(request.req.tools.filter(t => t.name.startsWith('mcp__')).map(t => t.name), [`mcp__${label.toLowerCase()}__echo`]);
    const final = requests.filter(r => r.provider === agent.provider).at(-1)!.req;
    const output = results(final), byId = (id: string) => output.find(r => r.toolUseId === id)!;
    assert.match(byId('read').content, /Shared user fact/); assert.doesNotMatch(byId('read').content, new RegExp(`${foreignLabel} private note`));
    assert.match(byId('search').content, new RegExp(agent.id)); assert.ok(!byId('search').content.includes(agent.id === first.id ? second.id : first.id));
    assert.equal(byId('foreign-note').isError, true); assert.equal(byId('foreign-skill').isError, true); assert.equal(byId('save-foreign-skill').isError, true);
    assert.match(byId('own-skill').content, new RegExp(`${label} procedure`));
    assert.equal(!!byId('write').isError, label === 'Beta');
    assert.equal(!!byId('schedule').isError, false);
  }
  assert.equal(readFileSync(join(h.home, 'mock.txt'), 'utf8'), 'mock');
  assert.equal(h.store.listMemory('agent', first.id)[0]!.text, aNote.text);
  assert.equal(h.store.listMemory('agent', second.id)[0]!.text, bNote.text);
  assert.deepEqual(h.store.listJobs().map(j => j.agentId), [first.id, second.id]);
  const ownTools = scheduleTools(h.scheduler, first.id), foreignJob = h.store.listJobs(second.id)[0]!;
  const ctx = { sessionId: 'test', origin: { kind: 'desktop' as const }, cwd: h.home, signal: new AbortController().signal, depth: 0 };
  assert.ok(!(await ownTools[1]!.run({}, ctx)).content.includes(foreignJob.id));
  assert.equal((await ownTools[2]!.run({ id: foreignJob.id }, ctx)).isError, true);
});

test('LINE uses the chosen agent, keeps one session per chat per agent, and falls back to the first; cron uses its job agent', async t => {
  const requests: ProviderRequest[] = [];
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) { requests.push(req); yield { type: 'text_delta', text: req.model }; yield done; } }), c => { c.line.allow.users = ['owner']; });
  const first = h.store.listAgents()[0]!;
  await new Promise(resolve => setTimeout(resolve, 2)); // A later timestamp, rather than a random-id tie.
  const second = h.store.createAgent({ name: 'Two', provider: 'mock', model: 'second-model', connectors: [], skills: [] });
  h.config.line.agentId = second.id;
  assert.equal(await h.runtime.lineMessage({ to: 'chat', userId: 'owner', text: 'one' }), 'second-model');
  await h.runtime.lineMessage({ to: 'chat', userId: 'owner', text: 'two' });
  const chosen = h.store.findSessionByOrigin({ kind: 'line', to: 'chat' }, second.id)!;
  assert.equal(h.store.listSessions().length, 1); assert.equal(h.store.getMessages(chosen.id).length, 4);
  h.config.line.agentId = 'unknown';
  assert.equal(await h.runtime.lineMessage({ to: 'chat', userId: 'owner', text: 'first' }), first.model);
  assert.equal(h.store.listSessions().length, 2);
  assert.ok(h.store.findSessionByOrigin({ kind: 'line', to: 'chat' }, first.id));
  delete h.config.line.agentId; assert.equal(h.runtime.lineAgent().id, first.id);
  const job = h.scheduler.add({ agentId: second.id, cron: '0 9 * * *', prompt: 'cron prompt', delivery: { kind: 'desktop' } });
  const notifications: any[] = []; h.runtime.subscribe(e => { if (e.type === 'notification') notifications.push(e); });
  await h.runtime.fireJob(job);
  assert.equal(requests.at(-1)!.model, second.model);
  assert.equal(h.store.findSessionByOrigin({ kind: 'cron', jobId: job.id }, second.id)?.agentId, second.id);
  assert.equal(notifications[0].body, second.model);
});

test('non-owner LINE leaves out notes for automatic and explicitly supplied per-agent profiles, and raises allows to ask', async t => {
  const requests: ProviderRequest[] = [];
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    requests.push(req);
    if (req.messages.length === 1) yield { type: 'tool_call', id: 'read', name: 'read_file', input: { path: 'private.txt' } };
    else yield { type: 'text_delta', text: 'done' };
    yield done;
  } }), c => { c.line.allow.users = ['owner']; });
  writeFileSync(join(h.home, 'private.txt'), 'owner-file');
  const agent = h.store.createAgent({ name: 'Private', provider: 'mock', model: 'private-model', instructions: 'Private instructions', permissions: { read_file: 'allow' } });
  h.store.addMemory('user', 'private-user-note'); h.store.addMemory('agent', 'private-agent-note', agent.id);
  for (const explicit of [false, true]) {
    const session = h.store.createSession({ origin: { kind: 'line', to: 'group' }, agentId: agent.id });
    const profile = explicit ? h.runtime.profile(h.config, true, agent) : undefined;
    await h.runtime.start(session.id, 'read private file', { userId: 'visitor', profile }).result;
    const req = requests.at(-1)!;
    assert.doesNotMatch(req.system, /private-user-note|private-agent-note/); assert.match(req.system, /Private instructions/);
    assert.match(results(req)[0]!.content, /denied by user/); assert.ok(!JSON.stringify(req.messages).includes('owner-file'));
  }
});

test('agent snapshots survive live edits; unknown providers produce run_end errors naming the provider', async t => {
  const requests: ProviderRequest[] = [];
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) { requests.push(req); yield { type: 'text_delta', text: req.model }; yield done; } }));
  const agent = h.store.listAgents()[0]!, session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
  const running = h.runtime.start(session.id, 'first');
  h.store.updateAgent(agent.id, { model: 'edited', instructions: 'edited instructions' });
  assert.equal((await running.result).text, agent.model);
  assert.equal((await h.runtime.start(session.id, 'second').result).text, 'edited');
  assert.match(requests.at(-1)!.system, /edited instructions/);
  h.store.updateAgent(agent.id, { provider: 'removed-provider' });
  const events: any[] = []; h.runtime.subscribe(e => events.push(e));
  const failed = h.runtime.start(session.id, 'third');
  const result = await failed.result;
  assert.equal(result.status, 'error'); assert.match(result.error!, /removed-provider/);
  assert.equal(events.find(e => e.type === 'run_end' && e.runId === failed.runId).status, 'error');
  assert.equal(h.runtime.isRunning(session.id), false);
});

test('streaming holds back newly added longer secrets across deltas, and titles redact before whitespace normalization', async t => {
  let home = '';
  const sensitive = 'first  line\tsecond line ' + 'z'.repeat(50), prefix = 'ordinary '.repeat(40);
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream() {
    setSecret('VALUE', sensitive, home);
    yield { type: 'text_delta', text: prefix + sensitive.slice(0, 45) };
    yield { type: 'text_delta', text: sensitive.slice(45) + ' tail' };
    yield done;
  } })); home = h.home;
  const events: any[] = []; h.runtime.subscribe(e => events.push(e));
  const agentId = h.store.listAgents()[0]!.id, session = h.store.createSession({ origin: { kind: 'desktop' }, agentId });
  const input = `Start ${sensitive} finish`;
  const result = await h.runtime.start(session.id, input).result;
  assert.equal(result.status, 'done');
  assert.equal(events.filter(e => e.type === 'text_delta').map(e => e.text).join(''), prefix + maskSecret(sensitive) + ' tail');
  assert.equal(h.store.getSession(session.id)!.title, `Start ${maskSecret(sensitive)} finish`);
  assert.ok(!JSON.stringify(h.store.getMessages(session.id)).includes('z'.repeat(12)));
  await h.runtime.fireJob({ id: 'title', agentId, cron: '0 9 * * *', prompt: input, delivery: { kind: 'desktop' }, enabled: true });
  assert.equal(h.store.findSessionByOrigin({ kind: 'cron', jobId: 'title' }, agentId)?.title, `Scheduled: Start ${maskSecret(sensitive)} finish`);
});

test('profile memory always has an agent owner, including a default profile', async t => {
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream() { yield done; } }));
  const first = h.store.listAgents()[0]!;
  t.mock.method(Date, 'now', () => first.createdAt + 1); // Keep this fixture's default agent oldest.
  const second = h.store.createAgent({ name: 'Other', provider: 'mock', model: 'test-model' });
  h.store.addMemory('user', 'shared fact');
  h.store.addMemory('agent', 'first-only note', first.id);
  h.store.addMemory('agent', 'second-only note', second.id);
  assert.match(h.runtime.profile().memory!, /shared fact|first-only note/);
  assert.doesNotMatch(h.runtime.profile().memory!, /second-only note/);
  assert.match(h.runtime.profile(h.config, true, second).memory!, /second-only note/);
  assert.doesNotMatch(h.runtime.profile(h.config, true, second).memory!, /first-only note/);
});

test('non-owner LINE slash text remains plain, including REA with its connector off', async t => {
  const requests: ProviderRequest[] = [];
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    requests.push({ ...req, messages: structuredClone(req.messages) }); yield { type: 'text_delta', text: 'plain reply' }; yield done;
  } }), c => { c.line.allow.users = ['owner']; });
  saveSkill(paths(h.home).skills, { name: 'demo', description: 'Demo', body: 'PRIVATE SKILL BODY' });
  for (const text of ['/demo hello', '/rea /missing/target', '/rea']) {
    assert.equal(await h.runtime.lineMessage({ to: 'group', userId: 'visitor', text }), 'plain reply');
    const input = requests.at(-1)!.messages.at(-1)!.content;
    assert.deepEqual(input, [{ type: 'text', text }]);
    assert.ok(!JSON.stringify(requests.at(-1)!.messages).includes('PRIVATE SKILL BODY'));
  }
});
