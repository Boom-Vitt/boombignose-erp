import { test, type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, type Api } from '../src/api.ts';
import { mountAgentForm, mountAgents } from '../src/agents.ts';
import { freshHost } from '../src/dom.ts';
import { mountMemory } from '../src/settings/memory.ts';
import { mountModel } from '../src/settings/providers.ts';
import { mountSchedules } from '../src/settings/schedules.ts';
import { mountSkills } from '../src/settings/skills.ts';
import { mountTools } from '../src/settings/tools.ts';
import { changeText, checkWorkspace, cronFor, describeCron, dirty, generalFromConfig, generalToConfig, hooksFromConfig, hooksToConfig } from '../src/settings/forms.ts';
import type { Config, Job, MemoryNote } from '../src/types.ts';
import { agent as agentFixture, config as configFixture } from './agent-fixture.ts';
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
  mountModel(pane as unknown as HTMLElement, {
    getSettings: async () => ({ config: config(), secrets: {} }), listAgents: async () => ({ agents: [] }),
    providerStatus: async () => ({ warnings: [] }), listModels: async () => ({ ok: true, models: [] }), doctor,
  } as unknown as Api);
  await flush();
  const button = pane.querySelectorAll('button').find(b => b.textContent === 'Run diagnostics');
  assert.ok(button, 'the Model tab needs a diagnostics action');
  return { pane, button };
}

test('T17 Model offers diagnostics without running them on mount', { timeout: 2000 }, async t => {
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


// ---- the form helpers

test('a relative or missing workspace folder is refused in the form; ~ and absolute paths pass for the daemon to check', () => {
  for (const bad of ['', '  ', 'relative/dir', './here', '~user/x', 'Documents']) assert.throws(() => checkWorkspace(bad), /workspace/i, bad);
  assert.equal(checkWorkspace(' ~/Documents '), '~/Documents'); assert.equal(checkWorkspace('~'), '~'); assert.equal(checkWorkspace('/Users/me/work'), '/Users/me/work');
  assert.throws(() => generalToConfig(config(), { ...generalFromConfig(config()), workspace: 'relative/dir' }), /full path/);
});

test('the save bar words: one change with short values, two, three or more, a secret, and the LINE note', t => {
  t.after(installDom());
  const say = (...a: Parameters<typeof changeText>) => changeText(...a).map(n => typeof n === 'string' ? n : (n as unknown as TestNode).textContent).join('');
  assert.equal(say([{ label: 'Model', from: 'qwen3:4b', to: 'qwen3:8b' }]), 'Model changed from qwen3:4b to qwen3:8b');
  assert.equal(say([{ label: 'Instructions', from: 'a'.repeat(30), to: 'b' }]), 'Instructions changed', 'long values are not quoted');
  assert.equal(say([{ label: 'Model', from: '', to: 'x' }]), 'Model changed', 'a blank side is not quoted');
  assert.equal(say([{ label: 'API key', secret: true }]), 'API key replaced');
  assert.equal(say([{ label: 'API key', secret: true, from: 'old', to: 'new' }]), 'API key replaced', 'a secret never shows a value');
  assert.equal(say([{ label: 'Model' }, { label: 'Context window' }]), 'Model and Context window changed');
  assert.equal(say([{ label: 'Model' }, { label: 'A' }, { label: 'B' }]), 'Model and 2 more changed');
  assert.equal(say([{ label: 'Local port' }], ' · LINE will reconnect'), 'Local port changed · LINE will reconnect');
  assert.deepEqual(dirty({ a: '1', b: '2', c: 'x' }, { a: '1', b: '3', c: 'y' }, { secret: ['c'] }), [{ label: 'b', from: '2', to: '3' }, { label: 'c', secret: true }]);
  assert.deepEqual(dirty({ a: '1' }, { a: '2' }, { hidden: ['a'] }), [{ label: 'a' }]);
});

test('When turns into cron: Weekdays 09:00, Every day 07:30, Every week, Every hour and Custom; and reads it back in words', () => {
  assert.equal(cronFor('weekdays', '09:00', '1', ''), '0 9 * * 1-5');
  assert.equal(cronFor('day', '07:30', '1', ''), '30 7 * * *');
  assert.equal(cronFor('week', '18:05', '5', ''), '5 18 * * 5');
  assert.equal(cronFor('hour', '', '1', ''), '0 * * * *');
  assert.equal(cronFor('custom', '', '1', '  */5   * * * * '), '*/5 * * * *');
  assert.throws(() => cronFor('day', '', '1', ''), /time/i);
  assert.deepEqual(['0 9 * * 1-5', '30 7 * * *', '5 18 * * 5', '0 * * * *', '0 0 1 * *'].map(describeCron),
    ['Weekdays at 09:00', 'Every day at 07:30', 'Every Friday at 18:05', 'Every hour', '0 0 1 * *']);
});

test('T17 diagnostics do not pass while a warning is listed', { timeout: 2000 }, async t => {
  const { pane, button } = await diagnostics(t, async () => ({ code: 0, lines: ['ok sqlite', 'warn Ollama is not running at http://127.0.0.1:11434 (start it with "ollama serve" or open the Ollama app)', 'note Ollama picks its own context size'] }));
  button.fire('click'); await flush();
  assert.doesNotMatch(pane.textContent, /all checks passed/i);
  assert.match(pane.textContent, /some checks need attention/i);
  assert.ok(pane.querySelectorAll('.result').some(n => n.className.includes('warn')));
  assert.match(pane.querySelector('.diag')!.textContent, /warn Ollama is not running/);
  assert.equal(pane.querySelector('.diag')!.tag, 'pre');
});

// ---- Tools

const control = (n: TestNode, label: string) => {
  const found = n.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label);
  assert.ok(found, `Missing field: ${label}`);
  return found.querySelector('input') ?? found.querySelector('textarea') ?? found.querySelector('select')!;
};
const type = (form: TestNode, field: TestNode, value: string) => { field.value = value; field.fire('input'); form.fire('input'); };

function toolsHarness(change?: (c: Config) => void) {
  let stored = config(); change?.(stored);
  const calls: { path: string; method: string; body: any }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body });
    if (path === '/api/settings') { if (method === 'PUT') stored = body.config; return json({ config: stored, secrets: {} }); }
    if (path === '/api/skills') return json({ skills: [{ name: 'taxes', description: 'File taxes' }, { name: 'notes', description: 'Notes' }] });
    if (path === '/api/mcp') return json({ servers: [] });
    assert.fail(`${method} ${path}`);
  }) as typeof fetch });
  return { api, pane: new TestNode('div'), calls, config: () => stored };
}
const pressed = (row: TestNode) => row.querySelectorAll('button').filter(b => b.attrs['aria-pressed'] === 'true').map(b => b.textContent);
const groupRow = (pane: TestNode, label: string) => pane.querySelectorAll('.row').find(r => r.querySelector('.seg')?.attrs['aria-label'] === label)!;
const mountedTools = async (h: ReturnType<typeof toolsHarness>) => { mountTools(h.pane as unknown as HTMLElement, h.api); await flush(); return h.pane.querySelector('.tools-page')!; };

test('Tools shows four plain groups with what each does today, and a click saves the group as one rule per tool', async t => {
  t.after(installDom());
  const h = toolsHarness(); const page = await mountedTools(h);
  assert.deepEqual(['Read files', 'Change files', 'Run commands', 'Open web pages'].map(l => pressed(groupRow(page, l))), [['Allow'], ['Ask'], ['Ask'], ['Ask']]);
  assert.equal(page.querySelector('.save-bar')!.hidden, true);
  button(groupRow(page, 'Run commands'), 'Allow').fire('click');
  assert.deepEqual(pressed(groupRow(page, 'Run commands')), ['Allow']);
  assert.equal(page.querySelector('.save-bar-text')!.textContent, 'Run commands changed from Ask to Allow');
  button(page, 'Save').fire('click'); await flush();
  assert.deepEqual(h.config().permissions, { shell: 'allow' }, 'only the group that was pressed is written');
  assert.deepEqual(h.config().hooks.preTool, config().hooks.preTool, 'other settings are untouched');
  assert.ok(page.textContent.includes('Never hides the tool from BigNose completely.'));
});

test('Tools shows no pressed segment for a mixed group and names what each tool does', async t => {
  t.after(installDom());
  const h = toolsHarness(c => { c.permissions = { write_file: 'allow', 'mcp__rea__*': 'deny' }; });
  const page = await mountedTools(h);
  assert.deepEqual(pressed(groupRow(page, 'Change files')), []);
  assert.match(groupRow(page, 'Change files').textContent, /write_file Allow · edit_file Ask/);
  assert.deepEqual(page.querySelectorAll('.kv').map(r => [r.querySelector('input')!.value, r.querySelector('select')!.value]), [['mcp__rea__*', 'deny']]);
  button(page, 'Add rule').fire('click');
  const names = page.querySelectorAll('.kv').map(r => r.querySelector('input')!);
  names[1]!.value = 'mcp__rea__*'; names[1]!.fire('input'); page.fire('input');
  button(page, 'Save').fire('click'); await flush();
  assert.deepEqual(h.config().permissions, { write_file: 'allow', 'mcp__rea__*': 'deny' }, 'two rules for one tool are refused, nothing is saved');
});

test('Tools shows the policy the core uses: the tool\'s own rule, then the longest prefix* rule, then the default; pressing a segment always needs Save', async t => {
  t.after(installDom());
  const h = toolsHarness(c => { c.permissions = { '*': 'allow' }; });
  const page = await mountedTools(h);
  assert.deepEqual(['Read files', 'Change files', 'Run commands', 'Open web pages'].map(l => pressed(groupRow(page, l))), [['Allow'], ['Allow'], ['Allow'], ['Allow']], 'a * rule decides every tool');
  assert.equal(page.querySelector('.save-bar')!.hidden, true);
  assert.ok(page.textContent.includes('A rule for one tool beats a prefix rule, and a prefix rule beats the defaults.'));
  button(groupRow(page, 'Run commands'), 'Allow').fire('click');
  assert.equal(page.querySelector('.save-bar')!.hidden, false, 'pressing Allow writes shell: allow, so it can be saved');
  assert.equal(page.querySelector('.save-bar-text')!.textContent, 'Run commands changed');
  button(groupRow(page, 'Run commands'), 'Ask').fire('click');
  assert.equal(page.querySelector('.save-bar-text')!.textContent, 'Run commands changed from Allow to Ask');
  button(page, 'Save').fire('click'); await flush();
  assert.deepEqual(h.config().permissions, { '*': 'allow', shell: 'ask' }, 'the group writes its own exact rule, which beats the * rule');
  const longer = toolsHarness(c => { c.permissions = { '*': 'allow', 'shell*': 'deny', read_file: 'ask' }; });
  const second = await mountedTools(longer);
  assert.deepEqual([pressed(groupRow(second, 'Run commands')), pressed(groupRow(second, 'Read files')), pressed(groupRow(second, 'Open web pages'))], [['Never'], [], ['Allow']]);
  assert.match(groupRow(second, 'Read files').textContent, /read_file Ask · list_files Allow · search_files Allow/);
});

test('the workspace folder is checked only when it changes: a relative one is refused, ~ goes to the daemon, a stale stored one never blocks another save', async t => {
  const toasts = withToasts(t);
  const stale = toolsHarness(c => { c.agent.workspace = 'relative/stale'; });
  const page = await mountedTools(stale);
  button(groupRow(page, 'Run commands'), 'Never').fire('click');
  button(page, 'Save').fire('click'); await flush();
  assert.deepEqual([stale.config().permissions, stale.config().agent.workspace], [{ shell: 'deny' }, 'relative/stale']);
  const h = toolsHarness(); const form = await mountedTools(h);
  type(form, control(form, 'Folder BigNose works in'), 'projects/shop');
  assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Workspace folder changed from /tmp/work to projects/shop');
  button(form, 'Save').fire('click'); await flush();
  assert.ok(!h.calls.some(c => c.method === 'PUT'), 'nothing is sent');
  assert.match(toasts.textContent, /full path/);
  type(form, control(form, 'Folder BigNose works in'), '~/Documents');
  button(form, 'Save').fire('click'); await flush();
  assert.equal(h.config().agent.workspace, '~/Documents', 'the daemon expands ~ and checks the folder');
});

test('Skills open as their own view from Tools, with a way back', async t => {
  t.after(installDom());
  const h = toolsHarness(); const page = await mountedTools(h);
  assert.ok(page.textContent.includes('2 skills'));
  button(page, 'Manage').fire('click'); await flush();
  assert.ok(h.pane.textContent.includes('taxes') && h.pane.textContent.includes('File taxes'));
  assert.equal(h.pane.querySelector('.tools-page'), null);
  button(h.pane, 'Tools').fire('click'); await flush();
  assert.ok(h.pane.querySelector('.tools-page'));
});

test('hooks sit under More options and are saved with the same bar', async t => {
  t.after(installDom());
  const h = toolsHarness(); const page = await mountedTools(h);
  assert.equal(page.querySelectorAll('.hook-row').length, 3);
  button(page, 'Remove hook').fire('click');
  assert.equal(page.querySelector('.save-bar-text')!.textContent, 'Hooks changed');
  button(page, 'Save').fire('click'); await flush();
  assert.equal(h.config().hooks.preTool!.length, 0); assert.equal(h.config().hooks.postTool!.length, 1);
});

// ---- Memory

function dialogs(t: TestContext) {
  const opened: TestNode[] = [];
  (document as any).body = { appendChild: (n: TestNode) => { opened.push(n); return n; } };
  (TestNode.prototype as any).showModal = function () {};
  t.after(() => { Reflect.deleteProperty(TestNode.prototype, 'showModal'); });
  return { opened, answer: (dialog: TestNode, value: string) => { (dialog as any).returnValue = value; dialog.fire('close'); } };
}
const note = (id: number, over: Partial<MemoryNote> = {}): MemoryNote => ({ id, agentId: null, kind: 'user', text: `Note ${id}`, updatedAt: Date.now(), ...over });

function memoryHarness(notes: MemoryNote[]) {
  const calls: { path: string; method: string; body: any; query: URLSearchParams }[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const u = new URL(String(url)), path = u.pathname, method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body, query: u.searchParams });
    if (path === '/api/agents') return json({ agents: [agentFixture, { ...agentFixture, id: 'a2', name: 'Two' }] });
    if (path === '/api/memory' && method === 'GET') return json({ notes: notes.filter(n => !u.searchParams.get('agent') || n.agentId === u.searchParams.get('agent')) });
    if (path === '/api/memory' && method === 'POST') { notes.push(note(99, { text: body.text, kind: body.kind, agentId: body.agentId ?? null })); return json({}); }
    if (path.startsWith('/api/memory/')) { const id = Number(path.split('/').at(-1)); if (method === 'DELETE') notes.splice(notes.findIndex(n => n.id === id), 1); else notes.find(n => n.id === id)!.text = body.text; return json({}); }
    assert.fail(`${method} ${path}`);
  }) as typeof fetch });
  return { api, pane: new TestNode('div'), calls, notes };
}

test('Memory is one card of rows with a ⋯ menu, an empty state, and filters only for a long list', async t => {
  t.after(installDom());
  const few = memoryHarness([note(1, { text: 'ชอบตอบสั้น' }), note(2, { kind: 'agent', agentId: 'a2', text: 'Uses metric' })]);
  mountMemory(few.pane as unknown as HTMLElement, few.api); await flush();
  const rows = few.pane.querySelectorAll('.note');
  assert.equal(rows.length, 2); assert.equal(rows[0]!.querySelector('.note-text')!.attrs.lang, 'th');
  assert.match(rows[0]!.querySelector('.row-sub')!.textContent, /^About you · /); assert.match(rows[1]!.querySelector('.row-sub')!.textContent, /^Two · /);
  assert.equal(few.pane.querySelector('.toolbar')!.hidden, true, 'no filters for two notes');
  assert.ok(button(rows[0]!, 'Edit…') && button(rows[0]!, 'Delete…'));
  const many = memoryHarness(Array.from({ length: 11 }, (_, i) => note(i + 1)));
  mountMemory(many.pane as unknown as HTMLElement, many.api); await flush();
  assert.equal(many.pane.querySelector('.toolbar')!.hidden, false, 'filters appear above ten notes');
  const filter = many.pane.querySelector('.toolbar')!.querySelectorAll('select')[0]!;
  filter.value = 'a2'; filter.fire('change'); await flush();
  assert.equal(many.calls.filter(c => c.path === '/api/memory' && c.method === 'GET').at(-1)!.query.get('agent'), 'a2');
  assert.equal(many.pane.querySelector('.toolbar')!.hidden, false, 'a narrow result keeps the filters');
  const none = memoryHarness([]); mountMemory(none.pane as unknown as HTMLElement, none.api); await flush();
  assert.match(none.pane.querySelector('.empty-row')!.textContent, /No notes yet\. BigNose saves what it learns about you here\./);
});

test('Memory adds a note (an agent note names its agent), edits in place, and deletes only after the dialog says yes', async t => {
  t.after(installDom());
  const d = dialogs(t);
  const h = memoryHarness([note(1)]);
  mountMemory(h.pane as unknown as HTMLElement, h.api); await flush();
  const form = h.pane.querySelector('form')!; assert.equal(form.hidden, true);
  button(h.pane, 'Add note').fire('click'); assert.equal(form.hidden, false);
  const kind = control(form, 'Type'); kind.value = 'agent'; kind.fire('change');
  control(form, 'Agent for agent notes').value = 'a2'; control(form, 'Note').value = 'Owned note';
  form.fire('submit'); await flush();
  assert.deepEqual(h.calls.find(c => c.method === 'POST')!.body, { kind: 'agent', text: 'Owned note', agentId: 'a2' });
  assert.equal(h.pane.querySelectorAll('.note').length, 2);
  let first = h.pane.querySelectorAll('.note')[0]!;
  button(first, 'Edit…').fire('click');
  first.querySelector('textarea')!.value = 'Edited'; button(first, 'Save').fire('click'); await flush();
  assert.equal(h.notes[0]!.text, 'Edited');
  first = h.pane.querySelectorAll('.note')[0]!;
  button(first, 'Delete…').fire('click'); await flush();
  assert.equal(d.opened[0]!.querySelector('h2')!.textContent, 'Delete this note?');
  d.answer(d.opened[0]!, 'cancel'); await flush();
  assert.ok(!h.calls.some(c => c.method === 'DELETE'));
  button(h.pane.querySelectorAll('.note')[0]!, 'Delete…').fire('click'); await flush();
  d.answer(d.opened[1]!, 'ok'); await flush();
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1); assert.equal(h.pane.querySelectorAll('.note').length, 1);
});

// ---- Schedules

const job = (id: string, over: Partial<Job> = {}): Job => ({ id, agentId: 'a1', cron: '0 9 * * 1-5', prompt: `Job ${id}`, delivery: { kind: 'desktop' }, enabled: true, ...over });
function scheduleHarness(jobs: Job[], lineRunning = true) {
  const calls: { path: string; method: string; body: any; query: URLSearchParams }[] = [];
  const stored = structuredClone(configFixture); stored.line.allow = { users: ['Uf3a0123456789abcdef91c'], groups: [], rooms: [] };
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const u = new URL(String(url)), path = u.pathname, method = init?.method ?? 'GET', body = init?.body ? JSON.parse(String(init.body)) : {};
    calls.push({ path, method, body, query: u.searchParams });
    if (path === '/api/agents') return json({ agents: [agentFixture, { ...agentFixture, id: 'a2', name: 'Two' }] });
    if (path === '/api/settings') return json({ config: stored, secrets: {} });
    if (path === '/api/line/status') return json({ running: lineRunning });
    if (path === '/api/schedules' && method === 'GET') return json({ jobs: jobs.filter(j => !u.searchParams.get('agent') || j.agentId === u.searchParams.get('agent')) });
    if (path === '/api/schedules' && method === 'POST') { jobs.push(job('new', { cron: body.cron, prompt: body.prompt, agentId: body.agentId })); return json({}); }
    if (path.startsWith('/api/schedules/')) { if (method === 'DELETE') jobs.splice(0, jobs.length, ...jobs.filter(j => j.id !== path.split('/').at(-1))); return json({}); }
    assert.fail(`${method} ${path}`);
  }) as typeof fetch });
  return { api, pane: new TestNode('div'), calls, jobs };
}
const openSchedules = async (h: ReturnType<typeof scheduleHarness>, agent?: string) => {
  mountSchedules(h.pane as unknown as HTMLElement, h.api, agent); await flush();
  button(h.pane, 'Add schedule').fire('click');
  return h.pane.querySelector('form')!;
};
const whenSelects = (form: TestNode) => form.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'When')!.querySelectorAll('select');
const timeInput = (form: TestNode) => form.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'When')!.querySelector('input')!;

test('Schedules reads each job as a sentence: when, agent, LINE chat, next run, and a failed last run', async t => {
  t.after(installDom());
  const h = scheduleHarness([job('1', { delivery: { kind: 'line', to: 'Uf3a0123456789abcdef91c' }, nextRunAt: Date.now() + 1000, lastStatus: 'error: boom' }), job('2', { cron: '30 7 * * *', agentId: 'a2', prompt: 'ทักทาย' })]);
  mountSchedules(h.pane as unknown as HTMLElement, h.api); await flush();
  const rows = h.pane.querySelectorAll('.schedules')[0]!.querySelectorAll('.row');
  assert.match(rows[0]!.querySelector('.row-sub')!.textContent, /^Weekdays at 09:00 · One · to LINE Uf3a…91c · next .* · Last run failed$/);
  assert.ok(rows[0]!.querySelectorAll('.status').some(n => n.className.includes('bad')));
  assert.match(rows[1]!.querySelector('.row-sub')!.textContent, /^Every day at 07:30 · Two$/); assert.equal(rows[1]!.querySelector('.note-text')!.attrs.lang, 'th');
  assert.equal(h.pane.querySelector('form')!.hidden, true, 'the new-schedule form waits for Add schedule');
});

test('choosing Weekdays + 09:00 posts 0 9 * * 1-5, Every day + 07:30 posts 30 7 * * *, and the save bar says what will be added', async t => {
  t.after(installDom());
  const h = scheduleHarness([]); const form = await openSchedules(h);
  control(form, 'What to do').value = 'Morning brief';
  const [when] = whenSelects(form); when!.value = 'weekdays'; when!.fire('change'); timeInput(form).value = '09:00'; timeInput(form).fire('input');
  assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Weekdays at 09:00 · One');
  assert.equal(button(form, 'Add schedule').attrs.type, 'submit');
  form.fire('submit'); await flush();
  assert.equal(h.calls.find(c => c.method === 'POST')!.body.cron, '0 9 * * 1-5');
  button(h.pane, 'Add schedule').fire('click');
  control(form, 'What to do').value = 'Evening';
  when!.value = 'day'; when!.fire('change'); timeInput(form).value = '07:30'; timeInput(form).fire('input');
  form.fire('submit'); await flush();
  assert.deepEqual(h.calls.filter(c => c.method === 'POST').map(c => c.body.cron), ['0 9 * * 1-5', '30 7 * * *']);
  assert.equal(h.calls.filter(c => c.method === 'POST')[0]!.body.agentId, 'a1'); assert.deepEqual(h.calls.find(c => c.method === 'POST')!.body.delivery, { kind: 'desktop' });
});

test('Every week adds a weekday, Every hour drops the time, Custom shows the cron field', async t => {
  t.after(installDom());
  const h = scheduleHarness([]); const form = await openSchedules(h);
  const [when, weekday] = whenSelects(form);
  const cronField = form.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'Cron expression')!;
  assert.deepEqual([weekday!.hidden, timeInput(form).hidden, cronField.hidden], [true, false, true]);
  when!.value = 'week'; when!.fire('change'); assert.equal(weekday!.hidden, false);
  weekday!.value = '5'; weekday!.fire('change'); assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Every Friday at 09:00 · One');
  when!.value = 'hour'; when!.fire('change'); assert.equal(timeInput(form).hidden, true); assert.equal(form.querySelector('.save-bar-text')!.textContent, 'Every hour · One');
  when!.value = 'custom'; when!.fire('change'); assert.equal(cronField.hidden, false);
  control(form, 'What to do').value = 'Often'; control(form, 'Cron expression').value = '*/15 * * * *'; form.fire('submit'); await flush();
  assert.equal(h.calls.find(c => c.method === 'POST')!.body.cron, '*/15 * * * *');
});

test('a LINE-delivery schedule is refused while LINE is off: the form says so and posts nothing', async t => {
  const toasts = withToasts(t);
  const h = scheduleHarness([], false); const form = await openSchedules(h);
  const sendTo = control(form, 'Send the answer to');
  assert.deepEqual(sendTo.querySelectorAll('option').map(o => o.textContent), ['This app', 'LINE Uf3a…91c', 'Other LINE chat…']);
  control(form, 'What to do').value = 'Daily brief';
  sendTo.value = '__other'; sendTo.fire('change');
  assert.equal(form.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === 'LINE chat ID')!.hidden, false);
  assert.ok(form.textContent.includes('Approvals only work in allowed chats.'));
  input(form, 'U… or C… or R…').value = 'Cabc';
  form.fire('submit'); await flush();
  assert.ok(!h.calls.some(c => c.method === 'POST'));
  assert.match(toasts.textContent, /LINE is off/);
  const on = scheduleHarness([], true); const form2 = await openSchedules(on);
  control(form2, 'What to do').value = 'Daily brief'; const pick = control(form2, 'Send the answer to'); pick.value = 'Uf3a0123456789abcdef91c'; pick.fire('change');
  form2.fire('submit'); await flush();
  assert.deepEqual(on.calls.find(c => c.method === 'POST')!.body.delivery, { kind: 'line', to: 'Uf3a0123456789abcdef91c' });
});

test('Schedules honours ?agent=<id>: it asks for that agent, says so, offers Show all, and presets the new schedule', async t => {
  t.after(installDom());
  const h = scheduleHarness([job('1'), job('2', { agentId: 'a2' })]);
  const form = await openSchedules(h, 'a2');
  assert.equal(h.calls.find(c => c.path === '/api/schedules')!.query.get('agent'), 'a2');
  assert.equal(h.pane.querySelectorAll('.schedules')[0]!.querySelectorAll('.row').length, 1);
  assert.match(h.pane.querySelector('.filter-note')!.textContent, /^Showing schedules for Two\.Show all$/);
  assert.equal(control(form, 'Agent').value, 'a2');
  button(h.pane, 'Show all').fire('click'); assert.equal((globalThis as any).window.location.hash, '#/settings/schedules');
  const unknown = scheduleHarness([job('1')]); mountSchedules(unknown.pane as unknown as HTMLElement, unknown.api, 'gone'); await flush();
  assert.equal(unknown.pane.querySelector('.filter-note'), null, 'an agent that no longer exists is not a filter');
});

test('a schedule turns off with its switch and is deleted from its ⋯ menu only after the dialog says yes', async t => {
  t.after(installDom());
  const d = dialogs(t);
  const h = scheduleHarness([job('1')]);
  mountSchedules(h.pane as unknown as HTMLElement, h.api); await flush();
  const row = h.pane.querySelectorAll('.schedules')[0]!.querySelector('.row')!;
  const toggle = row.querySelectorAll('input').find(i => i.className.includes('switch'))!;
  toggle.checked = false; toggle.fire('change'); await flush();
  assert.deepEqual(h.calls.find(c => c.method === 'PATCH')!.body, { enabled: false });
  button(row, 'Delete…').fire('click'); await flush();
  assert.equal(d.opened[0]!.querySelector('h2')!.textContent, 'Delete this schedule?');
  d.answer(d.opened[0]!, 'cancel'); await flush(); assert.ok(!h.calls.some(c => c.method === 'DELETE'));
  button(row, 'Delete…').fire('click'); await flush(); d.answer(d.opened[1]!, 'ok'); await flush();
  assert.equal(h.calls.filter(c => c.method === 'DELETE').length, 1);
  assert.ok(h.pane.textContent.includes('No schedules yet.'));
});

// ---- routes

test('each agents route gets its own host: a roster that loads late cannot draw over the form', async t => {
  t.after(installDom());
  const roster = Promise.withResolvers<Response>(); let listed = 0;
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/agents') return ++listed === 1 ? roster.promise : json({ agents: [agentFixture] });
    if (path === '/api/settings') return json({ config: configFixture, secrets: {} });
    if (path === '/api/schedules') return json({ jobs: [] });
    if (path === '/api/mcp') return json({ servers: [] });
    if (path === '/api/skills') return json({ skills: [] });
    if (path.endsWith('/models')) return json({ ok: true, models: [] });
    assert.fail(path);
  }) as typeof fetch });
  const section = new TestNode('section');
  mountAgents(freshHost(section as unknown as HTMLElement), api, () => {});
  mountAgentForm(freshHost(section as unknown as HTMLElement), api, undefined, () => {});
  await flush();
  assert.ok(section.textContent.includes('New agent'));
  roster.resolve(json({ agents: [agentFixture] })); await flush();
  assert.equal(section.children.length, 1, 'only the newest route is attached');
  assert.ok(!section.textContent.includes('Each agent has its own instructions'), 'the stale roster did not draw over the form');
  assert.ok(section.querySelector('.agent-form'), 'the form is still there');
});
