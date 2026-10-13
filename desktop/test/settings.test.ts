import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { generalFromConfig, generalToConfig, hooksFromConfig, hooksToConfig } from '../src/settings/forms.ts';
import type { Config } from '../src/types.ts';

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
