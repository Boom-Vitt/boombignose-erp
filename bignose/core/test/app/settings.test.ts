import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { defaultConfig, maskSecret, setSecret } from '../../src/config.ts';
import { createCleaner, resolveWorkspace, restoreMaskedConfig, safeValue, settingsResponse } from '../../src/app/settings.ts';
import { testHome } from '../e2e/helpers.ts';

test('the blanket cleaner masks only long env values and the API token; literal MCP fields use their own masks', t => {
  const home = testHome(t), config = defaultConfig();
  const privateValue = 'private-' + 'x'.repeat(30), apiValue = 'api-' + 'y'.repeat(30), root = '/ordinary/filesystem/root';
  setSecret('VALUE', privateValue, home); setSecret('FLAG', 'short', home);
  config.mcp.servers.local = { transport: 'stdio', command: 'fake', enabled: false, env: { ROOT: root, VALUE: '${VALUE}' } };
  config.mcp.servers.http = { transport: 'http', url: 'https://mock.invalid', enabled: false, headers: { Authorization: 'literal-value' } };
  const clean = createCleaner(home, config, apiValue);
  assert.equal(clean(`${root} literal-value short ${privateValue} ${apiValue}`), `${root} literal-value short ${maskSecret(privateValue)} ${maskSecret(apiValue)}`);
  const response = settingsResponse(config, home);
  assert.deepEqual((response.config.mcp.servers.local as any).env, { ROOT: maskSecret(root), VALUE: '${VALUE}' });
  assert.equal((response.config.mcp.servers.http as any).headers.Authorization, maskSecret('literal-value'));
});

test('masked provider fields restore by id after reorder and unrelated edits, before content or index matching', t => {
  const home = testHome(t), config = defaultConfig(), one = 'one-' + 'x'.repeat(30), two = 'two-' + 'y'.repeat(30);
  setSecret('ONE', one, home); setSecret('TWO', two, home);
  config.providers = [
    { id: 'one', kind: 'openai-compatible', baseUrl: 'https://mock.invalid/' + one, label: 'One' },
    { id: 'two', kind: 'openai-compatible', baseUrl: 'https://mock.invalid/' + two, label: 'Two' },
  ];
  config.active = { provider: 'one', model: 'mock-model' };
  const clean = createCleaner(home, config), masked = safeValue(settingsResponse(config, home).config, clean);
  masked.providers.reverse(); masked.providers[0]!.label = 'Two renamed'; masked.providers[1]!.label = 'One renamed';
  const restored = restoreMaskedConfig(masked, config, clean);
  assert.deepEqual(restored.providers, [{ ...config.providers[1], label: 'Two renamed' }, { ...config.providers[0], label: 'One renamed' }]);
});

test('a relative or missing workspace folder is refused; ~ and a trailing slash resolve to an existing absolute folder', t => {
  const home = testHome(t), folder = join(home, 'folder'), file = join(home, 'file.txt');
  mkdirSync(folder); writeFileSync(file, 'x');
  assert.equal(resolveWorkspace(` ${folder}/ `), folder);
  assert.equal(resolveWorkspace('~'), homedir());
  for (const bad of ['', '  ', 'folder', './folder', '~folder', join(home, 'missing')]) assert.throws(() => resolveWorkspace(bad), /Workspace folder/, bad);
  assert.throws(() => resolveWorkspace(file), /not a folder/);
});
