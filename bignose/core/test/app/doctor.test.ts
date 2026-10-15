import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { doctor } from '../../src/app/doctor.ts';
import { setSecret } from '../../src/config.ts';
import { configured, testHome } from '../e2e/helpers.ts';

test('doctor creates a missing fresh-install home privately instead of hard-failing', async t => {
  const home = join(testHome(t), 'fresh-home');
  assert.equal(existsSync(home), false);
  const result = await doctor(home, async () => { throw new Error('fake offline'); });
  assert.equal(result.code, 0); assert.ok(result.lines.includes('ok home writable'));
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(existsSync(join(home, 'bignose.db')), false);
});

test('diagnostics check the provider the active agent uses, not the Settings seed', async t => {
  const home = testHome(t);
  configured(home, 'https://seed.invalid/v1', c => {
    c.providers = [{ id: 'ollama', kind: 'openai-compatible', baseUrl: 'https://seed.invalid/v1' },
      { id: 'remote', kind: 'anthropic', label: 'Remote', baseUrl: 'https://remote.invalid', apiKeyEnv: 'REMOTE_API_KEY' }];
    c.active = { provider: 'ollama', model: 'seed:1' };
  });
  const asked: string[] = [];
  const fetchImpl = async (url: RequestInfo | URL) => { asked.push(String(url)); return Response.json(String(url).endsWith('/models') ? { data: [{ id: 'seed:1' }] } : { models: [] }); };
  const seed = await doctor(home, fetchImpl);
  assert.ok(seed.lines.includes('ok Ollama has 1 models')); assert.ok(!seed.lines.some(l => /^warn/.test(l)));
  const agent = { provider: 'remote', model: 'claude-x' };
  const missingKey = await doctor(home, fetchImpl, agent);
  assert.ok(missingKey.lines.includes('warn the Remote key is unset (REMOTE_API_KEY)'));
  assert.ok(!missingKey.lines.some(l => /Ollama/.test(l)), 'the seed provider is not what runs');
  assert.deepEqual(asked.filter(u => u.includes('remote.invalid')), []);
  setSecret('REMOTE_API_KEY', 'fake-remote', home);
  assert.ok((await doctor(home, fetchImpl, agent)).lines.includes('ok Remote for claude-x'));
  const gone = await doctor(home, fetchImpl, { provider: 'deleted', model: 'm' });
  assert.equal(gone.code, 1); assert.ok(gone.lines.includes('fail provider deleted is not configured'));
});

test('diagnostics warn when Ollama does not have the model the active agent uses', async t => {
  const home = testHome(t);
  configured(home, 'https://ollama.invalid/v1', c => { c.providers[0]!.id = 'ollama'; c.active = { provider: 'ollama', model: 'qwen3:8b' }; });
  const has = (ids: string[]) => async (url: RequestInfo | URL) => Response.json(String(url).endsWith('/models') ? { data: ids.map(id => ({ id })) } : { models: [] });
  const missing = await doctor(home, has(['qwen3:4b']));
  assert.equal(missing.code, 0, 'a warning is not a failure');
  assert.ok(missing.lines.includes('warn Ollama does not have qwen3:8b (run "ollama pull qwen3:8b" or pick another model)'));
  assert.ok(!(await doctor(home, has(['qwen3:8b']))).lines.some(l => /does not have/.test(l)));
  assert.ok(!(await doctor(home, has(['qwen3:8b:latest']))).lines.some(l => /does not have/.test(l)));
});
