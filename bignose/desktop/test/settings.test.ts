import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, type Api } from '../src/api.ts';
import { mountGeneral } from '../src/settings/general.ts';
import { mountSchedules } from '../src/settings/schedules.ts';
import { mountSkills } from '../src/settings/skills.ts';
import { generalFromConfig, generalToConfig, hooksFromConfig, hooksToConfig } from '../src/settings/forms.ts';
import type { Config } from '../src/types.ts';
import { installDom, TestNode, flush, json } from './dom-fixture.ts';

function config(): Config {
  return {
    version: 1,
    active: { provider: 'local', model: 'test-model' },
    providers: [{ id: 'local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1234/v1' }],
    agent: { workspace: '/tmp/work', maxTurns: 30, compactAt: 0.8, systemPrompt: 'Keep this prompt' },
    permissions: { shell: 'ask' },
    hooks: {
      preTool: [{ command: 'check-input', tools: ['shell', 'write_file'], timeoutMs: 5000 }],
      postTool: [{ command: 'record-output' }],
      sessionEnd: [{ command: 'record-session', timeoutMs: 20000 }],
    },
    mcp: { servers: { rea: { transport: 'stdio', command: 'npx', enabled: false } } },
    line: { enabled: false, port: 47822, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } },
    api: { port: 47821 },
  };
}

test('General reads the workspace and numeric values into editable strings', () => {
  assert.deepEqual(generalFromConfig(config()), { workspace: '/tmp/work', maxTurns: '30', compactAt: '0.8' });
});

test('General saves numeric values without changing the source or unrelated settings', () => {
  const source = config();
  const before = structuredClone(source);
  const saved = generalToConfig(source, { workspace: ' /tmp/new folder ', maxTurns: '12', compactAt: '0.65' });
  assert.deepEqual(saved.agent, { workspace: '/tmp/new folder', maxTurns: 12, compactAt: 0.65, systemPrompt: 'Keep this prompt' });
  assert.deepEqual({ ...saved, agent: before.agent }, before);
  assert.deepEqual(source, before);
  assert.deepEqual(generalToConfig(source, generalFromConfig(source)), source);
});

test('General rejects an empty workspace, invalid turn limits and thresholds outside (0, 1]', () => {
  const form = generalFromConfig(config());
  assert.throws(() => generalToConfig(config(), { ...form, workspace: '  ' }), /workspace/i);
  for (const maxTurns of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
    assert.throws(() => generalToConfig(config(), { ...form, maxTurns }), /turns/i);
  }
  for (const compactAt of ['', '0', '-0.2', '1.01', 'NaN', 'Infinity']) {
    assert.throws(() => generalToConfig(config(), { ...form, compactAt }), /threshold/i);
  }
  assert.equal(generalToConfig(config(), { ...form, maxTurns: '1', compactAt: '1' }).agent.compactAt, 1);
});

test('Hooks reads all three events, filters and optional timeout into form rows', () => {
  assert.deepEqual(hooksFromConfig(config()), {
    preTool: [{ command: 'check-input', tools: 'shell\nwrite_file', timeoutMs: '5000' }],
    postTool: [{ command: 'record-output', tools: '', timeoutMs: '' }],
    sessionEnd: [{ command: 'record-session', tools: '', timeoutMs: '20000' }],
  });
  assert.deepEqual(hooksFromConfig({ ...config(), hooks: {} }), { preTool: [], postTool: [], sessionEnd: [] });
});

test('Hooks saves ordered rows, trims filters and omits blank optional fields', () => {
  const source = config();
  const before = structuredClone(source);
  const saved = hooksToConfig(source, {
    preTool: [
      { command: ' check-first ', tools: ' shell\r\n \nwrite_file ', timeoutMs: '500' },
      { command: 'check-second\necho done', tools: '', timeoutMs: '' },
    ],
    postTool: [],
    sessionEnd: [{ command: 'finish', tools: 'shell', timeoutMs: '1200' }],
  });
  assert.deepEqual(saved.hooks, {
    preTool: [
      { command: 'check-first', tools: ['shell', 'write_file'], timeoutMs: 500 },
      { command: 'check-second\necho done' },
    ],
    postTool: [],
    sessionEnd: [{ command: 'finish', timeoutMs: 1200 }],
  });
  assert.deepEqual({ ...saved, hooks: before.hooks }, before);
  assert.deepEqual(source, before);
  assert.deepEqual(hooksToConfig(source, hooksFromConfig(source)), source);
});

test('Hooks can remove every entry', () => {
  const source = config();
  assert.deepEqual(hooksToConfig(source, { preTool: [], postTool: [], sessionEnd: [] }).hooks,
    { preTool: [], postTool: [], sessionEnd: [] });
});

test('Hooks rejects blank commands and non-positive or non-integer timeouts', () => {
  for (const event of ['preTool', 'postTool', 'sessionEnd'] as const) {
    const form = { preTool: [], postTool: [], sessionEnd: [], [event]: [{ command: ' ', tools: '', timeoutMs: '' }] };
    assert.throws(() => hooksToConfig(config(), form), /command/i);
    for (const timeoutMs of ['0', '-1', '0.5', 'NaN', 'Infinity', '9007199254740992']) {
      assert.throws(() => hooksToConfig(config(), { ...form, [event]: [{ command: 'check', tools: '', timeoutMs }] }), /timeout/i);
    }
  }
});

test('General and Hooks save through fresh GET/PUT settings while preserving other screens', async () => {
  let stored = config();
  const methods: string[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:1/api/settings');
    methods.push(init?.method ?? 'GET');
    if (init?.method === 'PUT') stored = JSON.parse(String(init.body)).config;
    return new Response(JSON.stringify({ config: stored, secrets: {} }));
  }) as typeof fetch });
  const general = generalFromConfig(stored);
  const hooks = hooksFromConfig(stored);
  stored.line.enabled = true; // Another screen saved after the forms loaded.
  await api.updateSettings((c) => { c.agent = generalToConfig(c, { ...general, maxTurns: '9' }).agent; });
  await api.updateSettings((c) => { c.hooks = hooksToConfig(c, { ...hooks, postTool: [] }).hooks; });
  assert.deepEqual(methods, ['GET', 'PUT', 'GET', 'PUT']);
  assert.equal(stored.agent.maxTurns, 9);
  assert.equal(stored.line.enabled, true);
  assert.deepEqual(stored.hooks.postTool, []);
  assert.deepEqual(stored.hooks.preTool, [{ command: 'check-input', tools: ['shell', 'write_file'], timeoutMs: 5000 }]);
});

async function diagnostics(t: TestContext, doctor: () => Promise<{ code: number; lines: string[] }>) {
  t.after(installDom());
  const pane = new TestNode('section');
  mountGeneral(pane as unknown as HTMLElement, {
    getSettings: async () => ({ config: config(), secrets: {} }), doctor,
  } as unknown as Api);
  await flush();
  const button = pane.querySelectorAll('button').find(b => /diagnostic|doctor/i.test(b.textContent));
  assert.ok(button, 'General needs a diagnostics action');
  return { pane, button };
}

test('T17 General offers diagnostics without running them on mount', { timeout: 2000 }, async t => {
  let calls = 0;
  const { pane, button } = await diagnostics(t, async () => { calls++; return { code: 0, lines: [] }; });
  assert.match(pane.textContent, /Diagnostics/);
  assert.equal(button.textContent, 'Run diagnostics');
  assert.equal(button.disabled, false);
  assert.equal(calls, 0);
});

test('T17 successful diagnostics show every line as text and a passing summary', { timeout: 2000 }, async t => {
  let calls = 0;
  const lines = ['ok sqlite', 'ok home writable', '<script>unsafe()</script>'];
  const { pane, button } = await diagnostics(t, async () => { calls++; return { code: 0, lines }; });
  button.fire('click');
  await flush();
  assert.equal(calls, 1);
  assert.match(pane.textContent, /all checks passed/i);
  for (const line of lines) assert.ok(pane.textContent.includes(line));
  assert.equal(pane.querySelectorAll('script').length, 0);
  assert.equal(button.disabled, false);
});

test('T17 failed diagnostics show every line and a failing summary', { timeout: 2000 }, async t => {
  let calls = 0;
  const { pane, button } = await diagnostics(t, async () => {
    calls++; return { code: 1, lines: ['ok sqlite', 'fail home not writable'] };
  });
  button.fire('click');
  await flush();
  assert.equal(calls, 1);
  assert.match(pane.textContent, /some checks failed/i);
  assert.match(pane.textContent, /ok sqlite/);
  assert.match(pane.textContent, /fail home not writable/);
  assert.equal(button.disabled, false);
});

test('T17 pending diagnostics disable the action and ignore duplicate clicks', { timeout: 2000 }, async t => {
  let calls = 0;
  let finish!: (value: { code: number; lines: string[] }) => void;
  const pending = new Promise<{ code: number; lines: string[] }>(resolve => { finish = resolve; });
  const { pane, button } = await diagnostics(t, () => { calls++; return pending; });
  button.fire('click');
  assert.equal(button.disabled, true);
  button.fire('click');
  assert.equal(calls, 1);
  finish({ code: 0, lines: ['ok sqlite'] });
  await flush();
  assert.match(pane.textContent, /ok sqlite/);
  assert.equal(button.disabled, false);
});

test('T17 diagnostics errors offer Retry and recover with a fresh result', { timeout: 2000 }, async t => {
  let calls = 0;
  let finish!: (value: { code: number; lines: string[] }) => void;
  const pending = new Promise<{ code: number; lines: string[] }>(resolve => { finish = resolve; });
  const { pane, button } = await diagnostics(t, async () => {
    if (++calls === 1) throw new Error('Daemon unavailable <b>offline</b>');
    return pending;
  });
  button.fire('click');
  await flush();
  assert.match(pane.textContent, /Daemon unavailable <b>offline<\/b>/);
  assert.equal(pane.querySelectorAll('b').length, 0);
  assert.ok(pane.querySelectorAll('div').some(n => n.attrs.role === 'alert'));
  const retry = pane.querySelectorAll('button').find(b => b.textContent === 'Retry');
  assert.ok(retry, 'a failed request needs Retry');
  assert.equal(button.disabled, false);
  retry.fire('click');
  assert.equal(button.disabled, true);
  button.fire('click');
  retry.fire('click');
  assert.equal(calls, 2);
  assert.doesNotMatch(pane.textContent, /Daemon unavailable/);
  finish({ code: 0, lines: ['ok recovered'] });
  await flush();
  assert.match(pane.textContent, /ok recovered/);
  assert.match(pane.textContent, /all checks passed/i);
  assert.equal(pane.querySelectorAll('button').some(b => b.textContent === 'Retry'), false);
  assert.equal(button.disabled, false);
});

test('T17 re-running diagnostics replaces old lines and summary', { timeout: 2000 }, async t => {
  let calls = 0;
  let finish!: (value: { code: number; lines: string[] }) => void;
  const pending = new Promise<{ code: number; lines: string[] }>(resolve => { finish = resolve; });
  const { pane, button } = await diagnostics(t, async () => {
    if (++calls === 1) return { code: 1, lines: ['fail old home'] };
    return pending;
  });
  button.fire('click');
  await flush();
  assert.match(pane.textContent, /fail old home/);
  button.fire('click');
  assert.doesNotMatch(pane.textContent, /fail old home|some checks failed/i);
  finish({ code: 0, lines: ['ok new home'] });
  await flush();
  assert.equal(calls, 2);
  assert.doesNotMatch(pane.textContent, /fail old home|some checks failed/i);
  assert.match(pane.textContent, /ok new home/);
  assert.match(pane.textContent, /all checks passed/i);
});

test('T17 diagnostics client uses authenticated POST and preserves request errors', { timeout: 2000 }, async () => {
  let calls = 0;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    assert.equal(String(url), 'http://127.0.0.1:1/api/doctor');
    assert.equal(init?.method, 'POST');
    assert.equal(new Headers(init?.headers).get('Authorization'), 'Bearer test-token');
    assert.deepEqual(JSON.parse(String(init?.body)), {});
    return ++calls === 1 ? json({ code: 1, lines: ['fail sqlite'] }) : json({ error: 'Doctor unavailable' }, 503);
  }) as typeof fetch });
  assert.ok('doctor' in api, 'API needs doctor()');
  const doctor = (api as unknown as { doctor: () => Promise<unknown> }).doctor;
  assert.deepEqual(await doctor(), { code: 1, lines: ['fail sqlite'] });
  await assert.rejects(doctor(), /Doctor unavailable/);
});

// ---- Skills and Schedules pages

function withToasts(t: TestContext) {
  t.after(installDom());
  const host = new TestNode('div');
  (globalThis.document as unknown as { getElementById: () => TestNode }).getElementById = () => host;
  return host;
}
const all = (n: TestNode): TestNode[] => [n, ...n.children.flatMap(all)];
const button = (n: TestNode, label: string) => all(n).find(b => b.tag === 'button' && b.textContent === label)!;
const input = (n: TestNode, placeholder: string) => all(n).find(b => b.attrs.placeholder === placeholder)!;

test('creating a skill with an existing name is refused: New skill asks the daemon for create mode and shows its message', async t => {
  const toasts = withToasts(t);
  const puts: unknown[][] = [];
  const pane = new TestNode('section');
  mountSkills(pane as unknown as HTMLElement, {
    listSkills: async () => ({ skills: [{ name: 'taxes', description: 'File taxes' }] }),
    putSkill: async (...args: unknown[]) => { puts.push(args); throw Object.assign(new Error('A skill named "taxes" already exists.'), { status: 409 }); },
  } as unknown as Api);
  await flush();
  button(pane, 'New skill').fire('click');
  input(pane, 'my-skill').value = 'taxes';
  input(pane, 'When should BigNose use this skill?').value = 'Scratch';
  all(pane).find(n => n.tag === 'form')!.fire('submit');
  await flush();
  assert.deepEqual(puts, [['taxes', { description: 'Scratch', body: '' }, true]]);
  assert.match(toasts.textContent, /already exists/);
  assert.doesNotMatch(toasts.textContent, /Saved/);
});

test('a LINE-delivery schedule is refused while LINE is off: the form says so and posts nothing', async t => {
  const toasts = withToasts(t);
  const added: unknown[] = [];
  let lineRunning = false;
  const pane = new TestNode('section');
  mountSchedules(pane as unknown as HTMLElement, {
    listAgents: async () => ({ agents: [{ id: 'a1', name: 'BigNose' }] }),
    listSchedules: async () => ({ jobs: [] }),
    lineStatus: async () => ({ running: lineRunning }),
    addSchedule: async (job: unknown) => { added.push(job); },
  } as unknown as Api);
  await flush();
  const form = all(pane).find(n => n.tag === 'form')!;
  const fill = () => {
    input(pane, '0 9 * * 1-5').value = '0 9 * * *';
    input(pane, 'What should BigNose do?').value = 'Daily brief';
    const delivery = all(pane).find(n => n.tag === 'select' && n.children.some(o => o.value === 'line'))!;
    delivery.value = 'line'; delivery.fire('change');
    input(pane, 'U… or C… or R…').value = 'Cabc';
  };
  fill();
  form.fire('submit');
  await flush();
  assert.deepEqual(added, []);
  assert.match(toasts.textContent, /LINE is off/);
  lineRunning = true;
  form.fire('submit');
  await flush();
  assert.equal(added.length, 1);
});
