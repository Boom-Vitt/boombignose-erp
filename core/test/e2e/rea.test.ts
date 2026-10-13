import test from 'node:test';
import assert from 'node:assert/strict';
import { cli, testHome } from './helpers.ts';

test('real REA 6.1.0 initializes and lists at least 100 tools', { skip: process.env.BIGNOSE_SKIP_NETWORK === '1', timeout: 240_000 }, async t => {
  const result = await cli(testHome(t), ['mcp', 'test', 'rea'], 220_000);
  assert.equal(result.code, 0, result.stderr + result.stdout);
  const match = /^ok rea (\d+) tools$/m.exec(result.stdout);
  assert.ok(match && Number(match[1]) >= 100, result.stdout);
});
