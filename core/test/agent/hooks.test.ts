import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runHooks } from '../../src/agent/hooks.ts';

test('preTool blocks on first stderr line or timeout; filters unrelated tools', async () => {
  const payload = { event: 'preTool' as const, sessionId: 's', tool: 'shell', input: { command: 'true' } };
  assert.match((await runHooks([{ command: 'printf "blocked\\nmore\\n" >&2; exit 1' }], payload))!.content, /^blocked by hook: blocked$/);
  assert.match((await runHooks([{ command: 'sleep 30', timeoutMs: 20 }], payload))!.content, /timeout/);
  assert.equal(await runHooks([{ command: 'exit 1', tools: ['read_file'] }], payload), undefined);
});

test('postTool receives output as JSON and the hook event environment', async () => {
  const dir = mkdtempSync(tmpdir() + '/bn-');
  try {
    const file = dir + '/out';
    assert.equal(await runHooks([{ command: `cat > '${file}'; printf "$BIGNOSE_HOOK_EVENT" > '${file}.event'; exit 1` }], { event: 'postTool', sessionId: 's', tool: 'shell', output: 'hello', isError: false }), undefined);
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).output, 'hello');
    assert.equal(readFileSync(file + '.event', 'utf8'), 'postTool');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
