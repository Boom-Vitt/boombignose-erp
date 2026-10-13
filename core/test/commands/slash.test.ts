import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon } from '../../src/app/daemon.ts';
import { paths } from '../../src/config.ts';
import { deleteSkill, listSkills, loadSkill, saveSkill, skillTools } from '../../src/skills/index.ts';
import { configured, testHome } from '../e2e/helpers.ts';
import type { ProviderRequest, ToolContext } from '../../src/types.ts';
import type { ApiEvent } from '../../src/app/runtime.ts';

const skillName = 'reverse-engineer-anything';
const done = { type: 'done' as const, stopReason: 'end_turn' as const, usage: { inputTokens: 0, outputTokens: 0 } };
const fakeRea = { transport: 'stdio' as const, command: process.execPath,
  args: [fileURLToPath(new URL('../mcp/fake-server.ts', import.meta.url)), '--delay-init'], enabled: true };
type App = Awaited<ReturnType<typeof startDaemon>>;
async function call(a: App, path: string, method = 'GET', body?: unknown) {
  const res = await fetch(`http://127.0.0.1:${a.port}${path}`, { method,
    headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json() as any };
}
async function app(t: Parameters<typeof testHome>[0], onRequest: (req: ProviderRequest) => void = () => {}) {
  const home = testHome(t); configured(home);
  const a = await startDaemon({ home, providerFactory: () => ({ kind: 'openai-compatible', async *stream(req) {
    onRequest(req); yield { type: 'text_delta', text: '# Evidence report\nTool: echo; location: target. Unknown: runtime routes.' }; yield done;
  } }) });
  t.after(() => a.close()); return a;
}
function waitEvent(a: App, predicate: (e: ApiEvent) => boolean): Promise<ApiEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { unsubscribe(); reject(new Error('event timeout')); }, 5000);
    const unsubscribe = a.runtime.subscribe(e => { if (predicate(e)) { clearTimeout(timer); unsubscribe(); resolve(e); } });
  });
}

test('bundled REA is listed/loadable, user override wins, and all managed writes/deletes are refused', async t => {
  const home = testHome(t), dir = paths(home).skills;
  assert.equal(listSkills(dir).find(s => s.name === skillName)?.bundled, true);
  const skill = loadSkill(dir, skillName)!;
  assert.ok(skill.body.length > 100); assert.ok(skill.files.includes('references/javascript-applications.md'));
  const ctx: ToolContext = { sessionId: 'test', origin: { kind: 'desktop' }, cwd: home, signal: new AbortController().signal, depth: 0 };
  assert.match((await skillTools(dir)[0]!.run({ name: skillName }, ctx)).content, /references\/javascript-applications.md/);
  assert.throws(() => saveSkill(dir, { name: skillName, description: 'replacement', body: 'new' }), /built-in skill/);
  assert.throws(() => deleteSkill(dir, skillName), /built-in skill/);
  assert.equal((await skillTools(dir)[1]!.run({ name: skillName, description: 'replacement', body: 'new' }, ctx)).isError, true);
  assert.equal((await skillTools(dir, [])[1]!.run({ name: skillName, description: 'replacement', body: 'new' }, ctx)).content, 'built-in skill');
  mkdirSync(join(dir, skillName), { recursive: true });
  writeFileSync(join(dir, skillName, 'SKILL.md'), `---\nname: ${skillName}\ndescription: User override\n---\nCustom procedure\n`);
  assert.equal(loadSkill(dir, skillName)!.body, 'Custom procedure');
  assert.equal(listSkills(dir).filter(s => s.name === skillName).length, 1);
  assert.equal(listSkills(dir).find(s => s.name === skillName)!.description, 'User override');
  assert.throws(() => deleteSkill(dir, skillName), /built-in skill/);
});

test('listing and slash expansion distinguish commands, paths, errors and skill requests', async t => {
  const { listCommands, expandSlash } = await import('../../src/commands/index.ts');
  const cwd = testHome(t), target = join(cwd, 'Example App.asar'); writeFileSync(target, 'target');
  const skills = [{ name: 'rea', description: 'collision' }, { name: 'notes', description: 'Take notes' }];
  assert.deepEqual(listCommands(skills), [
    { name: 'rea', description: 'Reverse engineer an app or file with REA.', usage: '/rea <app or file path>', kind: 'builtin' },
    { name: 'notes', description: 'Take notes', usage: '/notes [request]', kind: 'skill' },
  ]);
  for (const input of ['hello', '/', '/foo', '/Users/x a', '/notes.md', '/notes!', ' /notes']) assert.equal(expandSlash(input, skills, { cwd }), null, input);
  assert.deepEqual(expandSlash('/notes', skills, { cwd }), { command: 'notes', skills: ['notes'], connectors: [], prompt: 'Use the notes skill.' });
  const notes = expandSlash('/notes line one\nline two', skills, { cwd })!;
  assert.ok(!('error' in notes)); assert.equal(notes.prompt, 'line one\nline two');
  assert.deepEqual(expandSlash('/rea', skills, { cwd }), { error: 'usage: /rea <app or file path>' });
  assert.deepEqual(expandSlash('/rea missing', skills, { cwd }), { error: `not found: ${join(cwd, 'missing')}` });
  for (const input of ['/rea "Example App.asar"', "/rea 'Example App.asar'", `/rea ${target}`]) {
    const result = expandSlash(input, skills, { cwd })!;
    assert.ok(!('error' in result));
    assert.equal(result.target, target); assert.deepEqual(result.connectors, ['rea']); assert.deepEqual(result.skills, [skillName]);
    assert.match(result.prompt, /Markdown/); assert.ok(result.prompt.includes(target)); assert.match(result.prompt, /IPC/); assert.match(result.prompt, /already connected/);
  }
  const tilde = expandSlash('/rea ~', skills, { cwd })!;
  assert.ok(!('error' in tilde)); assert.equal(tilde.target, homedir());
});

test('commands and skill API expose the bundle, scope skill commands by agent, and reject reserved mutations', async t => {
  const a = await app(t), first = a.runtime.store.listAgents()[0]!;
  saveSkill(paths(a.home).skills, { name: 'notes', description: 'Notes', body: 'Write notes.' });
  const second = a.runtime.store.createAgent({ name: 'Limited', provider: 'mock', model: 'test-model', skills: [] });
  assert.deepEqual((await call(a, `/api/commands?agent=${second.id}`)).body.commands.map((c: any) => c.name), ['rea']);
  assert.deepEqual((await call(a, '/api/commands')).body.commands.map((c: any) => c.name), ['rea', 'notes', skillName]);
  a.runtime.store.updateAgent(first.id, { skills: ['notes'] });
  assert.deepEqual((await call(a, `/api/commands?agent=${first.id}`)).body.commands.map((c: any) => c.name), ['rea', 'notes']);
  assert.equal((await call(a, '/api/commands?agent=missing')).status, 400);
  assert.equal((await call(a, '/api/skills')).body.skills.find((s: any) => s.name === skillName).bundled, true);
  assert.ok((await call(a, `/api/skills/${skillName}`)).body.body.length > 100);
  for (const [method, body] of [['PUT', { description: 'new', body: 'replace' }], ['DELETE', undefined]] as const) {
    const r = await call(a, `/api/skills/${skillName}`, method, body); assert.equal(r.status, 400); assert.match(r.body.error, /built-in skill/);
  }
});

test('REA off rejects before any run on API and LINE; agent connector selection is enforced', async t => {
  let calls = 0; const a = await app(t, () => { calls++; });
  const agent = a.runtime.store.listAgents()[0]!, session = a.runtime.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
  const events: ApiEvent[] = []; a.runtime.subscribe(e => events.push(e));
  const input = `/rea ${a.home}`;
  const rejected = await call(a, `/api/sessions/${session.id}/messages`, 'POST', { text: input });
  assert.equal(rejected.status, 409); assert.deepEqual(rejected.body, { error: 'connector rea is off for this agent', connector: 'rea' });
  assert.equal(calls, 0); assert.equal(events.length, 0); assert.deepEqual(a.runtime.store.getMessages(session.id), []);
  assert.match(await a.runtime.lineMessage({ to: 'chat', userId: 'owner', text: input }), /turn.*on.*app/i);
  assert.equal((await call(a, `/api/sessions/${session.id}/messages`, 'POST', { text: '/rea' })).status, 400);
  const config = a.config(); config.mcp.servers.rea = fakeRea;
  assert.equal((await call(a, '/api/settings', 'PUT', { config })).status, 200);
  a.runtime.store.updateAgent(agent.id, { connectors: [] });
  assert.equal((await call(a, `/api/sessions/${session.id}/messages`, 'POST', { text: input })).status, 409);
  assert.equal(calls, 0);
});

test('cold REA run waits, loads skill into model context, preserves slash transcript, saves private report and notifies', async t => {
  const requests: ProviderRequest[] = [], a = await app(t, req => requests.push({ ...req, messages: structuredClone(req.messages) }));
  const config = a.config(); config.mcp.servers.rea = fakeRea;
  // Saving directly emulates daemon cold startup without waiting on the settings route.
  const { saveConfig } = await import('../../src/config.ts'); saveConfig(config, a.home);
  await a.close();
  const cold = await startDaemon({ home: a.home, providerFactory: () => ({ kind: 'openai-compatible', async *stream(req) {
    requests.push({ ...req, messages: structuredClone(req.messages) }); yield { type: 'text_delta', text: '# REA report\nEvidence: echo at target. Unknown: routes.' }; yield done;
  } }) }); t.after(() => cold.close());
  const agent = cold.runtime.store.listAgents()[0]!; cold.runtime.store.updateAgent(agent.id, { connectors: ['rea'], skills: [] });
  const session = cold.runtime.store.createSession({ origin: { kind: 'desktop' }, agentId: agent.id });
  const input = `/rea "${a.home}"`;
  const notification = waitEvent(cold, e => e.type === 'notification' && e.title === 'Report saved');
  const end = waitEvent(cold, e => e.type === 'run_end' && e.sessionId === session.id);
  assert.equal((await call(cold, `/api/sessions/${session.id}/messages`, 'POST', { text: input })).status, 202);
  const ended = await end; assert.equal(ended.type, 'run_end');
  if (ended.type === 'run_end') assert.equal(ended.status, 'done', ended.error);
  const saved = await notification;
  assert.equal(requests.length, 1); const req = requests[0]!, modelText = JSON.stringify(req.messages);
  assert.ok(req.tools.some(t => t.name === 'mcp__rea__echo'));
  assert.match(modelText, /<skill name=\\"reverse-engineer-anything\\" folder=/); assert.match(modelText, /references\/javascript-applications.md/); assert.ok(modelText.includes(a.home));
  assert.equal(cold.runtime.store.getMessages(session.id)[0]!.content[0]!.type, 'text');
  assert.equal((cold.runtime.store.getMessages(session.id)[0]!.content[0] as { text: string }).text, input);
  assert.match(JSON.stringify(cold.runtime.store.getSession(session.id)!.context), /<skill/);
  assert.equal(saved.type, 'notification'); if (saved.type !== 'notification') return;
  assert.equal(saved.sessionId, session.id); assert.match(saved.body, /\/reports\/rea-[a-z0-9-]+-\d{8}-\d{6}\.md$/);
  assert.match(readFileSync(saved.body, 'utf8'), /# REA report/);
  assert.equal(statSync(saved.body).mode & 0o777, 0o600); assert.equal(statSync(join(cold.home, 'reports')).mode & 0o777, 0o700);
  assert.equal(readdirSync(join(cold.home, 'reports')).length, 1);
});

test('skill slash expansion reaches desktop, LINE, cron and CLI origins and leaves unknown slash text alone', async t => {
  const requests: ProviderRequest[] = [], a = await app(t, req => requests.push({ ...req, messages: structuredClone(req.messages) }));
  saveSkill(paths(a.home).skills, { name: 'notes', description: 'Notes', body: 'A custom note procedure.' });
  const first = a.runtime.store.listAgents()[0]!;
  a.runtime.store.updateAgent(first.id, { skills: ['notes'] });
  const origins = [{ kind: 'desktop' }, { kind: 'line', to: 'chat' }, { kind: 'cli' }] as const;
  for (const origin of origins) {
    const session = a.runtime.store.createSession({ agentId: first.id, origin });
    if (origin.kind === 'line') await a.runtime.lineMessage({ to: origin.to, userId: 'owner', text: '/notes Make a list.' });
    else await a.runtime.start(session.id, '/notes Make a list.').result;
    const message = requests.at(-1)!.messages[0]!.content[0]!; assert.equal(message.type, 'text');
    if (message.type === 'text') { assert.match(message.text, /A custom note procedure/); assert.match(message.text, /Make a list\.$/); }
    assert.deepEqual(a.runtime.store.getMessages(session.id)[0]!.content, [{ type: 'text', text: '/notes Make a list.' }]);
  }
  const job = a.scheduler.add({ agentId: first.id, cron: '0 9 * * *', prompt: '/notes Scheduled list.', delivery: { kind: 'desktop' } });
  await a.runtime.fireJob(job); assert.match(JSON.stringify(requests.at(-1)!.messages), /A custom note procedure/);
  const plain = a.runtime.store.createSession({ agentId: first.id, origin: { kind: 'desktop' } });
  await a.runtime.start(plain.id, '/not-enabled do a thing').result;
  assert.deepEqual(requests.at(-1)!.messages[0]!.content, [{ type: 'text', text: '/not-enabled do a thing' }]);
  assert.equal((await call(a, `/api/sessions/${plain.id}/messages`, 'POST', { text: '/rea nonexistent' })).status, 400);
});

test('REA startup failure ends with error without invoking the model or saving a report', async t => {
  const home = testHome(t); let calls = 0;
  configured(home, undefined, c => { c.mcp.servers.rea = { transport: 'stdio', command: process.execPath, args: ['-e', 'process.exit(2)'], enabled: true }; });
  const a = await startDaemon({ home, providerFactory: () => ({ kind: 'openai-compatible', async *stream() { calls++; yield done; } }) });
  t.after(() => a.close()); const agent = a.runtime.store.listAgents()[0]!;
  const session = a.runtime.store.createSession({ agentId: agent.id, origin: { kind: 'desktop' } });
  const events: ApiEvent[] = []; a.runtime.subscribe(e => events.push(e));
  const result = await a.runtime.start(session.id, `/rea ${home}`).result;
  assert.equal(result.status, 'error'); assert.match(result.error!, /connector rea.*exited/);
  assert.equal(calls, 0); assert.equal(a.runtime.isRunning(session.id), false);
  assert.ok(!events.some(e => e.type === 'notification' && e.title === 'Report saved'));
});

test('interrupting a run waiting for REA stops promptly and emits no report', async t => {
  const home = testHome(t); let calls = 0;
  configured(home, undefined, c => { c.mcp.servers.rea = { ...fakeRea, args: ['-e', 'process.stdin.resume()'] }; });
  const a = await startDaemon({ home, providerFactory: () => ({ kind: 'openai-compatible', async *stream() { calls++; yield done; } }) });
  t.after(() => a.close()); const agent = a.runtime.store.listAgents()[0]!;
  const session = a.runtime.store.createSession({ agentId: agent.id, origin: { kind: 'desktop' } });
  const events: ApiEvent[] = []; a.runtime.subscribe(e => events.push(e));
  const run = a.runtime.start(session.id, `/rea ${home}`);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(a.runtime.interrupt(session.id), true);
  assert.equal((await run.result).status, 'interrupted'); assert.equal(calls, 0);
  assert.ok(!events.some(e => e.type === 'notification' && e.title === 'Report saved'));
});
