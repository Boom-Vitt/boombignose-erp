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

test('the user message and title are saved when the run starts', async t => {
  const started = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream() {
    started.resolve(); await release.promise;
    yield { type: 'text_delta', text: 'late answer' }; yield done;
  } }));
  const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: h.store.listAgents()[0]!.id });
  const run = h.runtime.start(session.id, 'MY QUESTION  with   spaces');
  try {
    await started.promise; // the provider is mid-request: the run is neither finished nor failed
    assert.deepEqual(h.store.getMessages(session.id), [{ role: 'user', content: [{ type: 'text', text: 'MY QUESTION  with   spaces' }] }]);
    assert.equal(h.store.getSession(session.id)!.title, 'MY QUESTION with spaces');
  } finally { release.resolve(); }
  assert.equal((await run.result).status, 'done');
  assert.deepEqual(h.store.getMessages(session.id).map(m => m.role), ['user', 'assistant']); // the end of the run adds no duplicates
  assert.equal(h.store.searchMessages('MY QUESTION')[0]?.sessionId, session.id);
});

test('a running turn is visible in stored history', async t => {
  const second = Promise.withResolvers<void>(), release = Promise.withResolvers<void>();
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) { yield { type: 'text_delta', text: 'looking' }; yield { type: 'tool_call', id: 'c1', name: 'memory_read', input: {} }; yield done; return; }
    yield { type: 'text_delta', text: 'partial ' }; second.resolve(); await release.promise;
    yield { type: 'text_delta', text: 'answer' }; yield done;
  } }));
  const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: h.store.listAgents()[0]!.id });
  const events: any[] = []; h.runtime.subscribe(e => events.push(e));
  const run = h.runtime.start(session.id, 'work');
  try {
    await second.promise;
    // What a restart after a kill would read: a fresh connection sees the prompt and the finished tool step.
    const reopened = openStore(join(h.home, 'store.db'));
    try {
      assert.deepEqual(reopened.getMessages(session.id).map(m => `${m.role}:${m.content.map(b => b.type).join('+')}`), ['user:text', 'assistant:text+tool_use', 'user:tool_result']);
    } finally { reopened.close(); }
    // Text, tool start and tool end events are numbered 1, 2, 3 ... per run; the snapshot says which of them it already includes.
    const numbered = events.filter(e => e.seq !== undefined);
    assert.deepEqual(numbered.map(e => e.type), ['text_delta', 'tool_start', 'tool_end', 'text_delta']);
    assert.deepEqual(numbered.map(e => e.seq), [1, 2, 3, 4]);
    assert.deepEqual(h.runtime.liveTurn(session.id), { runId: run.runId, seq: 4, text: 'partial ', tools: [] });
  } finally { release.resolve(); }
  await run.result;
  assert.deepEqual(h.store.getMessages(session.id).map(m => m.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(h.runtime.liveTurn(session.id), undefined);
});

test('steps are redacted like the run end, including a secret that appears during the run', async t => {
  let home = '';
  const secret = 'late-secret-' + 'q'.repeat(20);
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) { setSecret('LATE', secret, home); yield { type: 'tool_call', id: 'c1', name: 'memory_read', input: { query: secret } }; yield done; return; }
    yield { type: 'text_delta', text: `ok ${secret}` }; yield done;
  } })); home = h.home;
  const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: h.store.listAgents()[0]!.id });
  await h.runtime.start(session.id, `my key is ${secret}`).result;
  assert.ok(!JSON.stringify(h.store.getMessages(session.id)).includes('q'.repeat(12)));
  assert.ok(!h.store.getSession(session.id)!.title.includes('q'.repeat(12)));
  assert.equal(h.store.searchMessages('q'.repeat(12)).length, 0); // the search index follows the rewritten rows
});

test('a failed step save does not stop the run or leave an unanswered tool call in the saved context', async t => {
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    if (req.messages.length === 1) { yield { type: 'tool_call', id: 'c1', name: 'memory_read', input: {} }; yield done; return; }
    yield { type: 'text_delta', text: 'all done' }; yield done;
  } }));
  const real = h.store.appendMessages.bind(h.store);
  let calls = 0;
  h.store.appendMessages = (...args) => { if (++calls === 2) throw new Error('database is locked'); return real(...args); }; // call 1 = the prompt, 2 = the tool_use step
  const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: h.store.listAgents()[0]!.id });
  const result = await h.runtime.start(session.id, 'work').result;
  assert.equal(result.status, 'done');
  const shape = (messages: { role: string; content: { type: string }[] }[]) => messages.map(m => `${m.role}:${m.content.map(b => b.type).join('+')}`);
  const expected = ['user:text', 'assistant:tool_use', 'user:tool_result', 'assistant:text'];
  assert.deepEqual(shape(h.store.getMessages(session.id)), expected); // the run end wrote what the failed save missed, once
  assert.deepEqual(shape(h.store.getSession(session.id)!.context), expected);
});

test('a failed scheduled run emits a failure notification', async t => {
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream() { throw new Error('provider down'); } }));
  const events: { type: string; title?: string; body?: string; sessionId?: string }[] = [];
  h.runtime.subscribe(e => { events.push(e); });
  const job = h.scheduler.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'morning   brief', delivery: { kind: 'desktop' } });
  await assert.rejects(h.runtime.fireJob(job), /provider down/);
  const notices = events.filter(e => e.type === 'notification');
  assert.equal(notices.length, 1);
  assert.equal(notices[0]!.title, 'Scheduled task failed');
  assert.equal(notices[0]!.body, 'morning brief: provider down');
  assert.equal(notices[0]!.sessionId, undefined, 'a notification without a session is a toast, whichever chat is open');
});

test('a LINE-delivery schedule is refused while LINE is off: fireJob stops before the model runs and says so', async t => {
  let calls = 0;
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream() { calls++; yield { type: 'text_delta', text: 'never delivered' }; yield done; } }));
  const events: { type: string; title?: string; body?: string }[] = [];
  h.runtime.subscribe(e => { events.push(e); });
  const job = h.scheduler.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'to LINE', delivery: { kind: 'line', to: 'Cabc' } });
  await assert.rejects(h.runtime.fireJob(job), /LINE is off/);
  assert.equal(calls, 0, 'no model call for an answer with nowhere to go');
  assert.equal(h.store.listSessions().length, 0);
  assert.match(events.find(e => e.type === 'notification')!.body ?? '', /LINE is off/);
});

test('denied tools are not offered to the model, nested delegates included; the rest stay', async t => {
  const requests: ProviderRequest[] = [];
  const h = await harness(t, () => ({ kind: 'openai-compatible', async *stream(req) {
    requests.push(req);
    if (req.messages.length === 1 && req.system.includes('You are BigNose')) yield { type: 'tool_call', id: 'd1', name: 'delegate', input: { task: 'look around' } };
    else yield { type: 'text_delta', text: 'ok' };
    yield done;
  } }), c => { c.mcp.servers.alpha = fakeMcp; c.permissions.edit_file = 'deny'; });
  const agent = h.store.listAgents()[0]!;
  h.store.updateAgent(agent.id, { permissions: { shell: 'deny', web_fetch: 'deny', 'mcp__*': 'deny' }, connectors: ['alpha'] });
  const session = h.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
  assert.equal((await h.runtime.start(session.id, 'work').result).status, 'done');
  assert.ok(requests.length >= 3, 'the parent run, the delegate run and the parent again');
  for (const req of requests) {
    const names = req.tools.map(tool => tool.name);
    for (const denied of ['shell', 'web_fetch', 'edit_file', 'mcp__alpha__echo']) assert.ok(!names.includes(denied), `${denied} is not offered`);
    for (const kept of ['read_file', 'write_file', 'memory_read']) assert.ok(names.includes(kept), `${kept} is still offered`);
  }
  assert.ok(requests.some(req => req.tools.some(tool => tool.name === 'delegate')), 'the parent keeps delegate');
});
