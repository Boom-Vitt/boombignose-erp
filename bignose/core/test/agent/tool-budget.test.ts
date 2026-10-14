import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runAgent } from '../../src/agent/loop.ts';
import type { RunOptions } from '../../src/agent/loop.ts';
import type { AgentEvent, Provider, ProviderEvent, Tool } from '../../src/types.ts';

const done: ProviderEvent = { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } };
const toolUse: ProviderEvent = { type: 'done', stopReason: 'tool_use', usage: { inputTokens: 1, outputTokens: 1 } };
const big = (n: number): Tool => ({ name: 'big', description: '', inputSchema: {}, defaultPolicy: 'allow', async run() { return { content: `HEAD${'x'.repeat(n - 8)}TAIL` }; } });
const small: Tool = { name: 'small', description: '', inputSchema: {}, defaultPolicy: 'allow', async run() { return { content: 'tiny result' }; } };
const calls = (...names: string[]): ProviderEvent[] => names.map((name, i) => ({ type: 'tool_call', id: `c${i}`, name, input: {} }));
function run(extra: Partial<RunOptions>, home: string) {
  const steps: ProviderEvent[][] = [[...calls('big', 'small'), toolUse], [{ type: 'text_delta', text: 'ok' }, done]];
  let i = 0;
  const provider: Provider = { kind: 'anthropic', async *stream() { yield* steps[i++] ?? []; } };
  const events: AgentEvent[] = [];
  return runAgent({ provider, model: 'fake', system: '', context: [], input: 'go', tools: [big(50_000), small], maxTurns: 5, maxTokens: 100,
    contextWindow: 8000, compactAt: 0.8, permissions: {}, hooks: {}, sessionId: 's1', origin: { kind: 'cli' }, cwd: home,
    signal: new AbortController().signal, onEvent: e => events.push(e), ...extra }).then(r => ({ r, events }));
}
const toolResults = (r: Awaited<ReturnType<typeof run>>['r']) => r.context.flatMap(m => m.content.flatMap(b => b.type === 'tool_result' ? [b] : []));

test('oversized tool results are budgeted to the context window', async t => {
  const home = mkdtempSync(join(tmpdir(), 'bn-budget-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const spillDir = join(home, 'tool-results');

  // 8000-token window: a result may use about 15% of it, so 50,000 characters become a preview, a note and a file path.
  const { r, events } = await run({ spillDir }, home);
  const [bigResult, smallResult] = toolResults(r);
  assert.equal(r.status, 'done');
  assert.ok(bigResult!.content.length < 5000, `budgeted result is ${bigResult!.content.length} characters`);
  assert.ok(bigResult!.content.startsWith('HEAD'));
  assert.ok(!bigResult!.content.includes('TAIL'));
  assert.equal(smallResult!.content, 'tiny result', 'small results pass through untouched');
  assert.equal(bigResult!.isError, false);
  const files = readdirSync(spillDir);
  assert.equal(files.length, 1);
  const file = join(spillDir, files[0]!);
  assert.ok(bigResult!.content.includes(file), 'the model is told where the full output is');
  assert.match(bigResult!.content, /50000 characters/);
  assert.equal(readFileSync(file, 'utf8'), `HEAD${'x'.repeat(50_000 - 8)}TAIL`, 'the file holds the full output');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  const end = events.find(e => e.type === 'tool_end' && e.name === 'big');
  assert.ok(end?.type === 'tool_end' && end.output.length <= 2000);

  // A larger window allows more: the cap scales with contextWindow (never above the 100,000 character tool cap).
  const roomy = await run({ spillDir: join(home, 'none'), contextWindow: 200_000 }, home);
  assert.equal(toolResults(roomy.r)[0]!.content.length, 50_000);

  // Without a spill directory the result is cut with a note instead.
  const cut = await run({}, home);
  assert.ok(toolResults(cut.r)[0]!.content.length < 5000 && /truncated/i.test(toolResults(cut.r)[0]!.content));

  // The saved file is redacted like everything else that leaves the process.
  const redacted = await run({ spillDir: join(home, 'redacted'), redact: s => s.replaceAll('TAIL', 'MASK') }, home);
  assert.equal(readFileSync(join(home, 'redacted', readdirSync(join(home, 'redacted'))[0]!), 'utf8').endsWith('MASK'), true);
  assert.equal(redacted.r.status, 'done');
});
