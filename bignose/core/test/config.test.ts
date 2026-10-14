import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inspect } from 'node:util';
import {
  defaultConfig, ensureApiToken, getApiKey, homeDir, loadConfig, maskSecret, paths, readEnv, redact, saveConfig,
  setSecret, VERSION,
} from '../src/config.ts';
import { log } from '../src/log.ts';

// Fresh BIGNOSE_HOME per test; never touches ~/.bignose.
function tmpHome(t: { after(fn: () => void): void }): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  const prev = process.env.BIGNOSE_HOME;
  process.env.BIGNOSE_HOME = dir;
  t.after(() => {
    if (prev === undefined) delete process.env.BIGNOSE_HOME;
    else process.env.BIGNOSE_HOME = prev;
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

const mode = (file: string) => fs.statSync(file).mode & 0o777;

test('defaults when there is no config file', (t) => {
  const home = tmpHome(t);
  const cfg = loadConfig();
  assert.deepEqual(cfg, defaultConfig());
  assert.equal(cfg.version, 1);
  assert.deepEqual(cfg.active, { provider: 'ollama', model: 'qwen3:4b' });
  assert.deepEqual(cfg.providers.map((p) => p.id), ['anthropic', 'openai', 'openrouter', 'ollama']);
  assert.deepEqual(cfg.providers, [
    { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', contextWindow: 200000, maxTokens: 8192 },
    { id: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', contextWindow: 128000 },
    { id: 'openrouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', contextWindow: 128000, maxTokens: 8192 },
    { id: 'ollama', kind: 'openai-compatible', label: 'Ollama (local)', baseUrl: 'http://127.0.0.1:11434/v1', apiKeyEnv: 'OLLAMA_API_KEY', contextWindow: 32768 },
  ]);
  assert.equal(cfg.agent.workspace, os.homedir());
  assert.equal(cfg.api.port, 47821);
  assert.equal(cfg.line.port, 47822);
  assert.deepEqual(cfg.mcp.servers.rea, { transport: 'stdio', command: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'], enabled: false });
  assert.equal(fs.existsSync(paths(home).config), false, 'loading must not create the file');
  assert.match(VERSION, /^\d+\.\d+\.\d+/);
});

test('BIGNOSE_HOME overrides the home dir, created 0700', (t) => {
  const dir = tmpHome(t);
  const nested = path.join(dir, 'a', 'b');
  process.env.BIGNOSE_HOME = nested;
  assert.equal(homeDir(), nested);
  assert.equal(mode(nested), 0o700);
  assert.equal(paths().config, path.join(nested, 'config.json'));
  assert.equal(paths().env, path.join(nested, '.env'));
  assert.equal(paths().apiToken, path.join(nested, 'api-token'));
});

test('deep merge: file values win, untouched defaults (rea) stay, arrays replace', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).config, JSON.stringify({
    active: { model: 'other-model' },
    api: { port: 1234 },
    providers: [{ id: 'only', kind: 'openai-compatible', baseUrl: 'http://x/v1' }],
    line: { allow: { users: ['U1'] } },
    mcp: { servers: { mine: { transport: 'http', url: 'http://x/mcp', enabled: true } } },
  }));
  const cfg = loadConfig();
  assert.deepEqual(cfg.active, { provider: 'ollama', model: 'other-model' });
  assert.equal(cfg.api.port, 1234);
  assert.deepEqual(cfg.providers.map((p) => p.id), ['only']);
  assert.deepEqual(cfg.line.allow, { users: ['U1'], groups: [], rooms: [] });
  assert.equal(cfg.line.slowResponseMs, 45000);
  assert.deepEqual(Object.keys(cfg.mcp.servers).sort(), ['mine', 'rea']);
  assert.equal(cfg.mcp.servers.rea!.enabled, false);
});

test('stored providers and active model keep the existing install unchanged', (t) => {
  const home = tmpHome(t);
  const stored = {
    active: { provider: 'anthropic', model: 'my-model' },
    providers: [
      { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://example.invalid', apiKeyEnv: 'MY_KEY' },
      { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', contextWindow: 32000 },
    ],
  };
  fs.writeFileSync(paths(home).config, JSON.stringify(stored));
  const cfg = loadConfig();
  assert.deepEqual(cfg.active, stored.active);
  // the only addition is the default cap (anthropic: 8192) that the saved entry lacked
  assert.deepEqual(cfg.providers, [{ ...stored.providers[0], maxTokens: 8192 }, stored.providers[1]]);
});

test('a saved openrouter provider without maxTokens gets the default', (t) => {
  const home = tmpHome(t);
  const stored = {
    providers: [
      { id: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1' },
      { id: 'openrouter', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1', apiKeyEnv: 'MY_KEY' },
      { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', contextWindow: 32000 },
    ],
  };
  fs.writeFileSync(paths(home).config, JSON.stringify(stored));
  const cfg = loadConfig();
  assert.equal(defaultConfig().providers.find((p) => p.id === 'openrouter')!.maxTokens, 8192);
  assert.deepEqual(cfg.providers[1], { ...stored.providers[1], maxTokens: 8192 });
  // no default cap, nothing is added (and no undefined key)
  assert.deepEqual(cfg.providers[0], stored.providers[0]);
  assert.deepEqual(cfg.providers[2], stored.providers[2]);
  assert.equal(Object.hasOwn(cfg.providers[2]!, 'maxTokens'), false);
});

test('a user-set provider maxTokens is kept', (t) => {
  const home = tmpHome(t);
  const stored = { providers: [{ id: 'openrouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', maxTokens: 32000 }] };
  fs.writeFileSync(paths(home).config, JSON.stringify(stored));
  assert.deepEqual(loadConfig().providers, stored.providers);
});

test('a file entry for rea overrides the default one', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).config, JSON.stringify({ mcp: { servers: { rea: { enabled: true } } } }));
  const rea = loadConfig().mcp.servers.rea!;
  assert.equal(rea.enabled, true);
  assert.equal(rea.transport, 'stdio');
});

test('merge ignores __proto__ keys', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).config, '{"__proto__":{"polluted":true},"api":{"__proto__":{"polluted":true}}}');
  const cfg = loadConfig() as unknown as Record<string, unknown>;
  assert.equal(cfg.polluted, undefined);
  assert.equal((cfg.api as Record<string, unknown>).polluted, undefined);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('invalid JSON or a non-object file throws with the path', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).config, '{ nope');
  assert.throws(() => loadConfig(), (e: Error) => e.message.includes(paths(home).config));
  fs.writeFileSync(paths(home).config, '[]');
  assert.throws(() => loadConfig(), (e: Error) => e.message.includes(paths(home).config));
});

test('saveConfig writes atomically and loadConfig reads it back', (t) => {
  const home = tmpHome(t);
  const cfg = defaultConfig();
  cfg.active.model = 'm1';
  cfg.permissions = { shell: 'allow', 'mcp__*': 'ask' };
  saveConfig(cfg);
  assert.deepEqual(loadConfig(), cfg);
  assert.match(fs.readFileSync(paths(home).config, 'utf8'), /^\{\n {2}"version": 1,/);
  assert.equal(mode(paths(home).config), 0o600);
  assert.deepEqual(fs.readdirSync(home), ['config.json'], 'no temp files left behind');
});

test('.env round trip keeps mode 0600', (t) => {
  const home = tmpHome(t);
  assert.deepEqual(readEnv(), {}, 'missing file = {}');
  setSecret('ANTHROPIC_API_KEY', 'abc-123-fake');
  setSecret('OPENAI_API_KEY', 'other-fake');
  assert.deepEqual(readEnv(), { ANTHROPIC_API_KEY: 'abc-123-fake', OPENAI_API_KEY: 'other-fake' });
  assert.equal(mode(paths(home).env), 0o600);
  setSecret('ANTHROPIC_API_KEY', 'replaced-fake');
  assert.equal(readEnv().ANTHROPIC_API_KEY, 'replaced-fake');
  setSecret('OPENAI_API_KEY', null);
  assert.deepEqual(readEnv(), { ANTHROPIC_API_KEY: 'replaced-fake' });
  setSecret('ANTHROPIC_API_KEY', null);
  assert.deepEqual(readEnv(), {});
  assert.equal(mode(paths(home).env), 0o600);
});

test('.env is 0600 after a write even when it existed as 0644', (t) => {
  const home = tmpHome(t);
  const file = paths(home).env;
  fs.writeFileSync(file, 'OLD_NAME=old\n', { mode: 0o644 });
  fs.chmodSync(file, 0o644);
  assert.equal(mode(file), 0o644);
  setSecret('NEW_NAME', 'new');
  assert.equal(mode(file), 0o600);
  assert.deepEqual(readEnv(), { OLD_NAME: 'old', NEW_NAME: 'new' });
});

test('.env parsing and rewriting keep comments, quotes and unrelated lines', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).env, [
    '# my keys', '', 'A_KEY="quoted value"', "B_KEY='single'", 'C_KEY=a=b=c', 'bad name=1', 'A_KEY=dup', '',
  ].join('\n'));
  assert.deepEqual(readEnv(), { A_KEY: 'dup', B_KEY: 'single', C_KEY: 'a=b=c' });
  setSecret('B_KEY', 'changed');
  const text = fs.readFileSync(paths(home).env, 'utf8');
  assert.match(text, /^# my keys\n\nA_KEY="quoted value"\nB_KEY=changed\nC_KEY=a=b=c\nbad name=1\nA_KEY=dup\n$/);
  setSecret('A_KEY', 'once');
  assert.equal(fs.readFileSync(paths(home).env, 'utf8').match(/^A_KEY=/gm)?.length, 1, 'duplicates collapse');
});

test('setSecret validates the name and the value', (t) => {
  tmpHome(t);
  for (const bad of ['', 'lower', '1ABC', 'A-B', 'A B', 'A=B']) {
    assert.throws(() => setSecret(bad, 'x'), /invalid secret name/, bad);
  }
  assert.throws(() => setSecret('GOOD_NAME', 'a\nb'), /newline/);
  assert.throws(() => setSecret('GOOD_NAME', 'a\rb'), /newline/);
  assert.deepEqual(readEnv(), {});
  setSecret('_OK_1', '');
  assert.deepEqual(readEnv(), { _OK_1: '' });
});

test('values with edge whitespace or quotes survive a round trip', (t) => {
  tmpHome(t);
  for (const v of [' lead', 'trail ', '"in quotes"', "'single'", 'has "inner" quotes', 'a#b']) {
    setSecret('EDGE', v);
    assert.equal(readEnv().EDGE, v, JSON.stringify(v));
  }
});

test('getApiKey reads the provider apiKeyEnv from .env', (t) => {
  tmpHome(t);
  const cfg = defaultConfig();
  assert.equal(getApiKey(cfg, 'anthropic'), undefined, 'not set yet');
  setSecret('ANTHROPIC_API_KEY', 'fake-anthropic');
  setSecret('OPENAI_API_KEY', '');
  assert.equal(getApiKey(cfg, 'anthropic'), 'fake-anthropic');
  assert.equal(getApiKey(cfg, 'openai'), undefined, 'empty = unset');
  assert.equal(getApiKey(cfg, 'ollama'), undefined, 'optional key is unset');
  setSecret('OLLAMA_API_KEY', 'fake-local');
  assert.equal(getApiKey(cfg, 'ollama'), 'fake-local');
  assert.equal(getApiKey(cfg, 'nope'), undefined, 'unknown provider');
});

test('maskSecret', () => {
  assert.equal(maskSecret(''), '');
  assert.equal(maskSecret('a'), '••••');
  assert.equal(maskSecret('12345678901'), '••••', '11 chars');
  assert.equal(maskSecret('123456789012'), '••••9012', '12 chars');
  assert.equal(maskSecret('x'.repeat(40) + 'wxyz'), '••••wxyz');
});

test('redact', () => {
  const a = 'a'.repeat(20) + 'AAAA';
  const b = 'short'; // 5 chars: masked like any other secret
  assert.equal(redact(`k=${a} again ${a}; ${b}`, [a, b]), 'k=••••AAAA again ••••AAAA; ••••');
  assert.equal(redact('token abcdef123456 here', ['abcdef123456']), 'token ••••3456 here');
  assert.equal(redact('abcdef', ['abcdef']), '••••', 'exactly 6 chars is redacted');
  assert.equal(redact('nothing to hide', ['zzzzzzzz', '']), 'nothing to hide');
  assert.equal(redact('a.c.e.g.i.k', ['a.c.e.g.i.k']), '••••', 'secret is matched literally, not as a regex');
  // longer secret first, so a secret that contains another one is masked as a whole
  assert.equal(redact('xx-abcdef-yy-abcdef', ['abcdef', 'xx-abcdef-yy-abcdef']), '••••cdef');
});

test('ensureApiToken is created once, stable and 0600', (t) => {
  const home = tmpHome(t);
  const token = ensureApiToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(mode(paths(home).apiToken), 0o600);
  assert.equal(fs.readFileSync(paths(home).apiToken, 'utf8').trim(), token);
  assert.deepEqual(fs.readdirSync(home), ['api-token'], 'no temp file left behind');
  assert.equal(ensureApiToken(), token);
  assert.equal(ensureApiToken(home), token);
  assert.deepEqual(fs.readdirSync(home), ['api-token'], 'none after the EEXIST path either');
  fs.chmodSync(paths(home).apiToken, 0o644);
  assert.equal(ensureApiToken(), token);
  assert.equal(mode(paths(home).apiToken), 0o600, 'wider bits are tightened');
});

test('ensureApiToken replaces an empty or damaged token file', (t) => {
  const home = tmpHome(t);
  fs.writeFileSync(paths(home).apiToken, '');
  const token = ensureApiToken();
  assert.match(token, /^[0-9a-f]{64}$/);
  assert.equal(ensureApiToken(), token);
  assert.equal(mode(paths(home).apiToken), 0o600);
});

test('a second install gets a different token', (t) => {
  tmpHome(t);
  const first = ensureApiToken();
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  t.after(() => fs.rmSync(other, { recursive: true, force: true }));
  assert.notEqual(ensureApiToken(other), first);
});

test('log redacts the current .env values', (t) => {
  tmpHome(t);
  const secret = 'fake-' + 'x'.repeat(20);
  setSecret('SOME_KEY', secret);
  const lines: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => (lines.push(String(chunk)), true));
  log.info('calling with', secret, { nested: secret });
  log.warn(`url?key=${secret}`);
  log.error(new Error(`failed for ${secret}`));
  assert.equal(lines.length, 3);
  assert.match(lines[0]!, / info calling with ••••xxxx /);
  assert.match(lines[1]!, / warn url\?key=••••xxxx\n$/);
  assert.match(lines[2]!, / error Error: failed for ••••xxxx/);
  for (const l of lines) assert.equal(l.includes(secret), false);
  const token = ensureApiToken();
  log.info(`auth ${token}`);
  assert.equal(lines.length, 4);
  assert.equal(lines[3]!.includes(token), false, 'the api-token file contents are redacted too');
});

test('log never prints a secret with a backslash and quotes, raw or escaped', (t) => {
  tmpHome(t);
  const lines: string[] = [];
  t.mock.method(process.stderr, 'write', (chunk: string | Uint8Array) => (lines.push(String(chunk)), true));
  const base = ['pa\\ss', "q'uote", 'd"ouble', 'tail'].join('-'); // backslash, single and double quote
  for (const secret of [base, base + '`']) { // with a backtick too, inspect switches to escaped single quotes
    setSecret('SOME_KEY', secret);
    lines.length = 0;
    log.info({ nested: secret });
    log.info(JSON.stringify({ nested: secret }));
    log.error(new Error(`failed for ${secret}`));
    assert.equal(lines.length, 3);
    const forms = [secret, inspect(secret).slice(1, -1), JSON.stringify(secret).slice(1, -1)];
    for (const l of lines) {
      assert.match(l, /••••/);
      for (const f of forms) assert.equal(l.includes(f), false, `${f} leaked`);
    }
  }
});
