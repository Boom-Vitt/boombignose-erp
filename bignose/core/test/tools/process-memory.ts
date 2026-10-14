import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import { runCommand } from '../../src/tools/process.ts';

if (!global.gc) throw new Error('Run this fixture with --expose-gc');
global.gc();
const before = process.memoryUsage().arrayBuffers;
const controller = new AbortController();
const result = runCommand("head -c 20000000 /dev/zero | tr '\\000' a; touch ready; sleep 1", {
  cwd: process.argv[2], timeoutMs: 5000, signal: controller.signal,
});
try {
  const deadline = Date.now() + 3000;
  while (!existsSync(process.argv[2] + '/ready')) {
    assert.ok(Date.now() < deadline, 'command did not finish producing output');
    await setTimeout(5);
  }
  // The ready file can appear before the pipe's in-flight chunks have been drained.
  const settleDeadline = Date.now() + 3000;
  global.gc();
  while (process.memoryUsage().arrayBuffers - before >= 1_000_000 && Date.now() < settleDeadline) {
    await setTimeout(50);
    global.gc();
  }
  assert.ok(process.memoryUsage().arrayBuffers - before < 1_000_000, 'discarded output buffers remain retained');
  const output = await result;
  assert.equal(output.code, 0);
  assert.equal(Buffer.byteLength(output.stdout + output.stderr), 100_000);
} finally {
  controller.abort();
  await result;
}
