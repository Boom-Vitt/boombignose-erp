import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runAgent } from '../../src/agent/loop.ts';
import type { RunOptions } from '../../src/agent/loop.ts';
import type { AgentEvent, Message, Provider, ProviderEvent, ProviderRequest, Tool } from '../../src/types.ts';

const done: ProviderEvent = { type: 'done', stopReason: 'end_turn', usage: { inputTokens: 12, outputTokens: 3 } };
const call = (id: string, name = 'echo'): ProviderEvent => ({ type: 'tool_call', id, name, input: { value: id } });
const echo: Tool = { name: 'echo', description: '', inputSchema: {}, defaultPolicy: 'allow', async run(i) { return { content: String(i.value) }; } };
function options(provider: Provider, extra: Partial<RunOptions> = {}): RunOptions {
  return { provider, model: 'fake', system: '', context: [], input: 'go', tools: [echo], maxTurns: 5, maxTokens: 100,
    contextWindow: 10000, compactAt: 0.8, permissions: {}, hooks: {}, sessionId: 's', origin: { kind: 'cli' },
    cwd: tmpdir(), signal: new AbortController().signal, ...extra };
}
function scripted(steps: ProviderEvent[][], requests: ProviderRequest[] = []): Provider {
  let i = 0;
  return { kind: 'anthropic', async *stream(req) { requests.push({ ...req, messages: structuredClone(req.messages) }); yield* steps[i++] ?? []; } };
}
const results = (context: Message[]) => context.flatMap(m => m.content.filter(b => b.type === 'tool_result'));

test('three-step chain answers ordered calls and emits streaming tool events before run_end', async () => {
  const events: AgentEvent[] = [], requests: ProviderRequest[] = [];
  const p = scripted([[{ type: 'text_delta', text: 'checking' }, call('a'), call('b'), { ...done, stopReason: 'tool_use' }], [call('c'), { ...done, stopReason: 'tool_use' }], [{ type: 'text_delta', text: 'finished' }, done]], requests);
  const r = await runAgent(options(p, { onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done'); assert.equal(r.text, 'finished');
  assert.deepEqual(results(r.context).map(b => b.content), ['a', 'b', 'c']);
  assert.equal(requests.length, 3); assert.equal(r.added[0]?.content[0]?.type, 'text');
  assert.equal(r.usage.inputTokens, 36);
  assert.deepEqual(events.map(e => e.type), ['text_delta', 'tool_start', 'tool_end', 'tool_start', 'tool_end', 'tool_start', 'tool_end', 'text_delta', 'run_end']);
});

test('max turns still answers the last tool call and provider errors become results', async () => {
  const r = await runAgent(options(scripted([[call('a'), done], [call('b'), done]]), { maxTurns: 2 }));
  assert.equal(r.status, 'max_turns'); assert.equal(results(r.context).length, 2);
  const error = await runAgent(options({ kind: 'anthropic', async *stream() { yield call('c'); throw new Error('offline'); } }));
  assert.equal(error.status, 'error'); assert.match(error.error!, /offline/);
  assert.equal(results(error.context)[0]?.isError, true);
});

test('interrupt mid-stream answers even a partially announced tool', async () => {
  const abort = new AbortController();
  const p: Provider = { kind: 'anthropic', async *stream() {
    yield { type: 'tool_call_start', id: 'partial', name: 'echo' };
    abort.abort();
    await new Promise(() => {});
  } };
  const r = await runAgent(options(p, { signal: abort.signal }));
  assert.equal(r.status, 'interrupted');
  assert.deepEqual(results(r.context), [{ type: 'tool_result', toolUseId: 'partial', content: 'interrupted', isError: true }]);
});

test('interrupt mid-tool answers running and queued calls without starting the queued tool', async () => {
  const abort = new AbortController(); let called = 0;
  const tool: Tool = { ...echo, async run(_, ctx) { called++; assert.equal(ctx.signal, abort.signal); abort.abort(); return new Promise(() => {}); } };
  const r = await runAgent(options(scripted([[call('a'), call('b'), done]]), { signal: abort.signal, tools: [tool] }));
  assert.equal(r.status, 'interrupted'); assert.equal(called, 1);
  assert.equal(results(r.context).length, 2); assert.ok(results(r.context).every(b => b.isError));
});

test('compaction summarises the head and preserves a recent complete tool pair', async () => {
  const context: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'long '.repeat(100) }] },
    { role: 'assistant', content: [{ type: 'text', text: 'old response' }] },
    { role: 'user', content: [{ type: 'text', text: 'recent' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'echo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'old', content: 'kept' }] },
  ];
  const requests: ProviderRequest[] = [], events: AgentEvent[] = [];
  const r = await runAgent(options(scripted([[{ type: 'text_delta', text: 'summary' }, done], [{ type: 'text_delta', text: 'answer' }, done]], requests), { context, contextWindow: 80, onEvent: e => events.push(e) }));
  assert.equal(requests[0]?.tools.length, 0);
  assert.equal(requests[0]?.messages.length, 1);
  assert.equal(requests[0]?.messages.at(-1)?.role, 'user');
  assert.ok(requests[0]?.messages.every(m => m.content.every(b => b.type === 'text')));
  assert.equal(requests[1]?.messages[0]?.content[0]?.type, 'text');
  assert.match((requests[1]!.messages[0]!.content[0] as { text: string }).text, /Summary of earlier conversation.*\nsummary/);
  assert.equal(results(r.context)[0]?.content, 'kept');
  assert.ok(events.some(e => e.type === 'compaction' && e.removedMessages === 2));
  assert.deepEqual(context[0]?.content[0], { type: 'text', text: 'long '.repeat(100) });
  assert.equal(r.added.length, 2);
});

test('delegate has fresh context, removes delegate and sessionEnd runs once only at top level', async () => {
  const dir = mkdtempSync(tmpdir() + '/bn-');
  try {
    let turn = 0;
    const p: Provider = { kind: 'anthropic', async *stream(req) {
      if (turn++ === 0) { yield { type: 'tool_call', id: 'd', name: 'delegate', input: { task: 'nested' } }; yield done; }
      else if (turn === 2) { assert.equal(req.messages.length, 1); assert.deepEqual(req.messages[0]?.content, [{ type: 'text', text: 'nested' }]); assert.ok(req.tools.every(t => t.name !== 'delegate')); yield { type: 'text_delta', text: 'nested answer' }; yield done; }
      else { yield { type: 'text_delta', text: 'parent answer' }; yield done; }
    } };
    const delegate: Tool = { ...echo, name: 'delegate', async run(i, ctx) { return { content: await ctx.delegate!(String(i.task)) }; } };
    const events: AgentEvent[] = [];
    const r = await runAgent(options(p, { tools: [delegate], onEvent: e => events.push(e), hooks: { sessionEnd: [{ command: `cat >> '${dir}/end'` }] } }));
    assert.equal(results(r.context)[0]?.content, 'nested answer');
    assert.equal(r.text, 'parent answer');
    assert.ok(!events.some(e => e.type === 'text_delta' && e.text === 'nested answer'));
    const end = JSON.parse(readFileSync(dir + '/end', 'utf8')); assert.equal(end.event, 'sessionEnd'); assert.equal(end.status, 'done');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('denials and preTool blocks still answer tools; approval events are paired', async () => {
  const events: AgentEvent[] = []; let called = false;
  const r = await runAgent(options(scripted([[call('a'), done], [done]]), { tools: [{ ...echo, defaultPolicy: 'ask', async run() { called = true; return { content: '' }; } }], approve: async () => false, onEvent: e => events.push(e) }));
  assert.equal(called, false); assert.equal(results(r.context)[0]?.content, 'denied by user');
  assert.deepEqual(events.filter(e => e.type.startsWith('approval_')).map(e => e.type), ['approval_request', 'approval_result']);
  const blocked = await runAgent(options(scripted([[call('b'), done], [done]]), { hooks: { preTool: [{ command: 'echo nope >&2; exit 1' }] } }));
  assert.equal(results(blocked.context)[0]?.content, 'blocked by hook: nope');
});

test('approval exceptions report denied; incomplete arguments never reach a tool', async () => {
  const events: AgentEvent[] = [];
  const r = await runAgent(options(scripted([[call('a'), done], [done]]), { tools: [{ ...echo, defaultPolicy: 'ask' }], approve: async () => { throw new Error('approval failed'); }, onEvent: e => events.push(e) }));
  assert.equal(results(r.context)[0]?.isError, true);
  assert.equal(events.find(e => e.type === 'approval_result')?.allowed, false);
  let called = false;
  const incomplete = await runAgent(options(scripted([[{ type: 'tool_call_start', id: 'partial', name: 'echo' }, done]]), { tools: [{ ...echo, async run() { called = true; return { content: '' }; } }] }));
  assert.equal(called, false); assert.equal(results(incomplete.context)[0]?.isError, true);
});

test('compaction during a tool chain keeps paired tail messages and respects the provider-call budget', async () => {
  let normal = 0, summaries = 0;
  const p: Provider = { kind: 'anthropic', async *stream(req) {
    if (!req.tools.length) { summaries++; yield { type: 'text_delta', text: 'older tool findings' }; yield done; }
    else if (normal++ < 3) { yield call(String(normal)); yield { ...done, stopReason: 'tool_use' }; }
    else { yield { type: 'text_delta', text: 'finished' }; yield done; }
  } };
  const tool: Tool = { ...echo, async run() { return { content: 'data '.repeat(100) }; } };
  const r = await runAgent(options(p, { tools: [tool], maxTurns: 10, contextWindow: 150 }));
  assert.equal(r.status, 'done'); assert.ok(summaries > 0);
  const ids = r.context.flatMap(m => m.content.flatMap(b => b.type === 'tool_use' ? [b.id] : []));
  assert.deepEqual(results(r.context).map(b => b.toolUseId), ids);
  assert.equal(results(r.added).length, 3);
  normal = 0; summaries = 0;
  const capped = await runAgent(options(p, { tools: [tool], maxTurns: 3, contextWindow: 150 }));
  assert.equal(capped.status, 'max_turns'); assert.equal(normal + summaries, 3);
});

test('compaction renders earlier tool calls and results as one user text message', async () => {
  const context: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'old task' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'past', name: 'echo', input: { value: 'old input' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'past', content: 'old output', isError: true }] },
    { role: 'assistant', content: [{ type: 'text', text: 'old response' }] },
    { role: 'user', content: [{ type: 'text', text: 'recent task' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'recent', name: 'echo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'recent', content: 'kept' }] },
  ];
  const requests: ProviderRequest[] = [];
  const r = await runAgent(options(scripted([[{ type: 'text_delta', text: 'summary' }, done], [done]], requests), { context, contextWindow: 80 }));
  const summary = requests[0]!;
  assert.deepEqual(summary.tools, []);
  assert.equal(summary.messages.length, 1);
  assert.equal(summary.messages[0]?.role, 'user');
  assert.ok(summary.messages[0]?.content.every(b => b.type === 'text'));
  const text = summary.messages[0]!.content.map(b => b.type === 'text' ? b.text : '').join('');
  for (const fragment of ['old task', 'echo', '{"value":"old input"}', 'old output', 'old response', 'past']) assert.ok(text.includes(fragment), fragment);
  assert.equal(r.status, 'done');
  assert.equal(results(r.context)[0]?.toolUseId, 'recent');
});

test('tools execute in completed-call order and incomplete announcements are answered last', async () => {
  const events: AgentEvent[] = [], requests: ProviderRequest[] = [];
  const p = scripted([[
    { type: 'tool_call_start', id: 'partial', name: 'echo' },
    { type: 'tool_call_start', id: 'b', name: 'echo' },
    { type: 'text_delta', text: 'checking' },
    { type: 'tool_call_start', id: 'a', name: 'echo' },
    call('a'), call('b'), done,
  ], [done]], requests);
  const r = await runAgent(options(p, { onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done');
  assert.deepEqual(results(r.context).map(b => b.toolUseId), ['a', 'b', 'partial']);
  assert.deepEqual(results(r.context).map(b => b.isError), [false, false, true]);
  assert.deepEqual(events.filter(e => e.type === 'tool_start').map(e => e.callId), ['a', 'b', 'partial']);
  const assistant = requests[1]!.messages.find(m => m.role === 'assistant')!;
  assert.deepEqual(assistant.content.filter(b => b.type === 'tool_use').map(b => b.id), ['a', 'b', 'partial']);
  assert.equal(assistant.content.find(b => b.type === 'text')?.text, 'checking');
});
