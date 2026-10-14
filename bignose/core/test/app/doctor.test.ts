import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { doctor } from '../../src/app/doctor.ts';
import { testHome } from '../e2e/helpers.ts';

test('doctor creates a missing fresh-install home privately instead of hard-failing', async t => {
  const home = join(testHome(t), 'fresh-home');
  assert.equal(existsSync(home), false);
  const result = await doctor(home, async () => { throw new Error('fake offline'); });
  assert.equal(result.code, 0); assert.ok(result.lines.includes('ok home writable'));
  assert.equal(statSync(home).mode & 0o777, 0o700);
  assert.equal(existsSync(join(home, 'bignose.db')), false);
});
