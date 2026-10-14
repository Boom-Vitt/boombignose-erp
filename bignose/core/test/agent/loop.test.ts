import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { runAgent } from '../../src/agent/loop.ts';
import type { RunOptions } from '../../src/agent/loop.ts';
import { validateTools } from '../../src/providers/common.ts';
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

test('invalid shell permission never executes the tool or asks for approval', async () => {
  let called = false, asked = false;
  const shell: Tool = { ...echo, name: 'shell', defaultPolicy: 'ask', async run() { called = true; return { content: 'ran' }; } };
  const r = await runAgent(options(scripted([[call('a', 'shell'), done], [done]]), {
    tools: [shell], permissions: { shell: 'ASK' as any }, approve: async () => { asked = true; return true; },
  }));
  assert.equal(called, false); assert.equal(asked, false);
  assert.deepEqual(results(r.context), [{ type: 'tool_result', toolUseId: 'a', content: 'invalid policy', isError: true }]);
});

test('delegate reports an error when its nested run exhausts maxTurns', async () => {
  const delegate: Tool = { ...echo, name: 'delegate', async run(i, ctx) { return { content: await ctx.delegate!(String(i.task)) }; } };
  const p = scripted([
    [{ type: 'tool_call', id: 'd', name: 'delegate', input: { task: 'nested' } }, done],
    [{ type: 'text_delta', text: 'partial narration' }, call('n'), done],
  ]);
  const r = await runAgent(options(p, { tools: [echo, delegate], maxTurns: 1 }));
  assert.equal(r.status, 'max_turns');
  assert.deepEqual(results(r.context), [{ type: 'tool_result', toolUseId: 'd', content: 'Delegate stopped: max_turns', isError: true }]);
});

/** Like `scripted`, but rejects what a real provider rejects: illegal tool names. */
function strict(steps: ProviderEvent[][], requests: ProviderRequest[] = []): Provider {
  const inner = scripted(steps, requests);
  return { kind: inner.kind, async *stream(req) { validateTools(req); yield* inner.stream(req); } };
}
const text = (t: string): ProviderEvent => ({ type: 'text_delta', text: t });

test('invalid tool name returns a tool error and the session keeps working', async () => {
  const p = strict([[call('a', 'functions.read_file'), { ...done, stopReason: 'tool_use' }], [text('recovered'), done], [text('later'), done]]);
  const first = await runAgent(options(p));
  assert.equal(first.status, 'done'); assert.equal(first.text, 'recovered');
  assert.deepEqual(results(first.context), [{ type: 'tool_result', toolUseId: 'a', content: 'Unknown tool: functions.read_file', isError: true }]);
  const second = await runAgent(options(p, { context: first.context, input: 'again' }));
  assert.equal(second.status, 'done'); assert.equal(second.text, 'later');
  // A session stored before this fix still holds the raw name; it heals on the next run.
  const legacy: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'old' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'x', name: 'functions.read_file', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: 'Unknown tool: functions.read_file', isError: true }] },
  ];
  const healed = await runAgent(options(strict([[text('ok'), done]]), { context: legacy }));
  assert.equal(healed.status, 'done');
  assert.equal(legacy[1]?.content[0]?.type === 'tool_use' && legacy[1].content[0].name, 'functions.read_file', 'the caller context is not mutated');
  // An absurd name cannot break the request either.
  const long = await runAgent(options(strict([[call('b', 'x.'.repeat(100)), { ...done, stopReason: 'tool_use' }], [text('fine'), done]])));
  assert.equal(long.status, 'done'); assert.equal(results(long.context)[0]?.isError, true);
});

test('malformed tool arguments return a tool error and sibling calls still run', async () => {
  const ran: string[] = [], events: AgentEvent[] = [], requests: ProviderRequest[] = [];
  const tool: Tool = { ...echo, async run(i) { ran.push(String(i.value)); return { content: String(i.value) }; } };
  const bad: ProviderEvent = { type: 'tool_call', id: 'bad', name: 'echo', input: {}, error: 'Invalid tool arguments: Unexpected end of JSON input. Send the call again with a complete JSON object.' };
  const r = await runAgent(options(scripted([[bad, call('ok'), { ...done, stopReason: 'tool_use' }], [text('fixed'), done]], requests), { tools: [tool], onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done'); assert.equal(r.text, 'fixed');
  assert.deepEqual(ran, ['ok'], 'the malformed call never reaches the tool');
  assert.deepEqual(results(r.context), [
    { type: 'tool_result', toolUseId: 'bad', content: bad.error, isError: true },
    { type: 'tool_result', toolUseId: 'ok', content: 'ok', isError: false },
  ]);
  assert.equal(requests.length, 2, 'the model gets another turn to fix the call');
  assert.deepEqual(events.filter(e => e.type === 'tool_end').map(e => e.type === 'tool_end' && e.isError), [true, false]);
  // A provider failure after the calls still fails the run and answers every call (unchanged).
  const broken = await runAgent(options({ kind: 'anthropic', async *stream() { yield call('a'); throw new Error('offline'); } }));
  assert.equal(broken.status, 'error'); assert.equal(results(broken.context)[0]?.isError, true);
});

test('compaction counts system, tools and reply budget', async () => {
  const context: Message[] = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `message ${i} ` + 'm'.repeat(280) }] }));
  const compacted = async (extra: Partial<RunOptions>) => {
    const requests: ProviderRequest[] = [], events: AgentEvent[] = [];
    const r = await runAgent(options(scripted([[text('summary'), done], [text('answer'), done]], requests), { context, contextWindow: 1000, onEvent: e => events.push(e), ...extra }));
    assert.equal(r.status, 'done');
    const summarised = events.some(e => e.type === 'compaction');
    assert.equal(requests[0]?.tools.length === 0, summarised, 'a compaction request is the one without tools');
    return summarised;
  };
  assert.equal(await compacted({}), false, 'a small context with a small prompt stays as it is');
  assert.equal(await compacted({ system: 'system prompt '.repeat(100) }), true, 'a long system prompt counts');
  assert.equal(await compacted({ tools: [{ ...echo, description: 'tool schema '.repeat(100) }] }), true, 'long tool schemas count');
  assert.equal(await compacted({ maxTokens: 450 }), true, 'the reply budget counts');
});

test('oversized recent tool output is pruned and runs recover', async () => {
  // Fake server with a hard limit: the request must stay under 1000 tokens (chars / 4), like OpenAI answering 400.
  const limit = 1000, seen: number[] = [];
  const server = (steps: ProviderEvent[][]): Provider => {
    const inner = scripted(steps);
    return { kind: 'openai-compatible', async *stream(req) {
      const tokens = (req.system.length + JSON.stringify(req.messages).length + JSON.stringify(req.tools).length) / 4;
      seen.push(tokens);
      if (tokens > limit) throw new Error(`Provider HTTP 400: This model's maximum context length is ${limit} tokens. However, your messages resulted in ${Math.round(tokens)} tokens.`);
      yield* inner.stream(req);
    } };
  };
  const context: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'read the log' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'echo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'big', content: 'z'.repeat(8000) }] },
  ];
  const first = await runAgent(options(server([[text('summarised the log'), done]]), { context, contextWindow: limit }));
  assert.equal(first.status, 'done'); assert.equal(first.text, 'summarised the log');
  const stored = results(first.context)[0]!;
  assert.ok(stored.content.length < 1500 && stored.content.startsWith('zzz') && /cleared to save context space/.test(stored.content));
  assert.equal(results(first.context).length, 1);
  assert.equal(context[2]?.content[0]?.type === 'tool_result' && context[2].content[0].content.length, 8000, 'the caller context is not mutated');
  const again = await runAgent(options(server([[text('and again'), done]]), { context: first.context, input: 'next question', contextWindow: limit }));
  assert.equal(again.status, 'done'); assert.ok(seen.every(t => t <= limit), `requests stayed under the limit: ${seen}`);
});

test('a provider context-length error compacts and retries once', async () => {
  // The estimate (chars / 4) says there is room, but the provider counts more tokens: the 400 forces a compaction.
  const context: Message[] = Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `turn ${i} ` + 'ก'.repeat(500) }] }));
  let main = 0, summaries = 0;
  const events: AgentEvent[] = [];
  const p: Provider = { kind: 'openai-compatible', async *stream(req) {
    if (!req.tools.length) { summaries++; yield text('older turns'); yield done; return; }
    if (main++ === 0) throw new Error("Provider HTTP 400: This model's maximum context length is 8192 tokens. However, your messages resulted in 9000 tokens.");
    yield text('answer'); yield done;
  } };
  const r = await runAgent(options(p, { context, contextWindow: 100_000, onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done'); assert.equal(r.text, 'answer');
  assert.equal(summaries, 1); assert.ok(events.some(e => e.type === 'compaction'));
  // A second overflow in a row is a real failure, not a loop.
  const stuck: Provider = { kind: 'openai-compatible', async *stream(req) { if (!req.tools.length) { yield text('s'); yield done; return; } throw new Error('Provider HTTP 413: Payload Too Large'); } };
  const failed = await runAgent(options(stuck, { context, contextWindow: 100_000, maxTurns: 20 }));
  assert.equal(failed.status, 'error'); assert.match(failed.error!, /413/);
  // Other errors are not retried.
  let calls = 0;
  const other = await runAgent(options({ kind: 'anthropic', async *stream() { calls++; throw new Error('Provider HTTP 401: bad key'); } }, { context }));
  assert.equal(other.status, 'error'); assert.equal(calls, 1);
});

const pieces = (secret: string) => Array.from({ length: secret.length - 7 }, (_, i) => secret.slice(i, i + 8));
const mask = (secret: string) => (s: string) => s.replaceAll(secret, 'MASKED');

test('pruned tool output and the summary request are redacted before they are cut', async () => {
  const secret = 'TopSecret' + 'q7'.repeat(15);
  // The prune head keeps 500 characters; the secret starts at 480.
  const big: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'read it' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'big', name: 'echo', input: {} }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'big', content: 'y'.repeat(480) + secret + 'z'.repeat(8000) }] },
  ];
  const pruned = await runAgent(options(scripted([[text('ok'), done]]), { context: big, contextWindow: 1000, redact: mask(secret) }));
  const stored = results(pruned.context)[0]!.content;
  assert.match(stored, /cleared to save context space/); assert.ok(stored.includes('MASKED'));
  for (const piece of pieces(secret)) assert.ok(!stored.includes(piece), `pruned result leaks ${piece}`);
  // The summary request cuts a tool result at 2000 characters; the secret crosses that cut and a 1000-character tool input cut.
  const old: Message[] = [
    { role: 'user', content: [{ type: 'text', text: 'start' }] },
    { role: 'assistant', content: [{ type: 'tool_use', id: 'old', name: 'echo', input: { value: 'v'.repeat(980) + secret } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 'old', content: 'r'.repeat(1980) + secret }] },
    ...[1, 2, 3, 4].map(i => ({ role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: `recent ${i}` }] }) as Message),
  ];
  const requests: ProviderRequest[] = [];
  await runAgent(options(scripted([[text('summary'), done], [text('answer'), done]], requests), { context: old, contextWindow: 80, redact: mask(secret) }));
  const sent = JSON.stringify(requests[0]!.messages);
  for (const piece of pieces(secret)) assert.ok(!sent.includes(piece), `summary request leaks ${piece}`);
});

test('approval, hooks and the tool all see the coerced arguments', async t => {
  const dir = mkdtempSync(tmpdir() + '/bn-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const seen: unknown[] = [], approved: unknown[] = [], events: AgentEvent[] = [];
  const tool: Tool = { name: 'count', description: '', defaultPolicy: 'ask', inputSchema: { type: 'object', properties: { n: { type: 'integer' }, all: { type: 'boolean' } } },
    async run(i) { seen.push(i); return { content: 'ok' }; } };
  const raw: ProviderEvent = { type: 'tool_call', id: 'a', name: 'count', input: { n: '5', all: 'true' } };
  const r = await runAgent(options(scripted([[raw, done], [done]]), { tools: [tool], onEvent: e => events.push(e),
    approve: async req => { approved.push(req.input); return true; },
    hooks: { preTool: [{ command: `cat >> '${dir}/pre'` }], postTool: [{ command: `cat >> '${dir}/post'` }] } }));
  assert.equal(r.status, 'done');
  const coerced = { n: 5, all: true };
  assert.deepEqual(seen, [coerced]); assert.deepEqual(approved, [coerced]);
  assert.deepEqual(JSON.parse(readFileSync(dir + '/pre', 'utf8')).input, coerced);
  assert.deepEqual(JSON.parse(readFileSync(dir + '/post', 'utf8')).input, coerced);
  const request = events.find(e => e.type === 'approval_request');
  assert.deepEqual(request?.type === 'approval_request' && request.input, coerced);
});

test('a summary request that overflows too is shrunk and retried instead of killing the session', async () => {
  // Thai text costs about one token a character, four times what chars / 4 assumes. The fake enforces its limit on every request.
  const tokens = (s: string) => { let n = 0; for (const c of s) n += c.charCodeAt(0) > 127 ? 1 : 0.25; return n; };
  const windowTokens = 8000, thai = (n: number, tag: string) => `${tag} ` + 'ก'.repeat(n);
  const context: Message[] = [...Array.from({ length: 6 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: thai(3000, `old ${i}`) }] }) as Message),
    ...['recent a', 'recent b', 'recent c'].map((t, i) => ({ role: i % 2 ? 'assistant' : 'user', content: [{ type: 'text', text: t }] }) as Message)];
  const sizes: number[] = [];
  const server: Provider = { kind: 'openai-compatible', async *stream(req) {
    const used = tokens(req.system) + tokens(JSON.stringify(req.messages)) + tokens(JSON.stringify(req.tools));
    sizes.push(Math.round(used));
    if (used > windowTokens) throw new Error(`Provider HTTP 400: This model's maximum context length is ${windowTokens} tokens. However, your messages resulted in ${Math.round(used)} tokens.`);
    yield text(req.tools.length ? 'answer' : 'earlier Thai conversation'); yield done;
  } };
  const run = () => runAgent(options(server, { context, contextWindow: windowTokens, maxTurns: 10 }));
  const first = await run();
  assert.equal(first.status, 'done', first.error); assert.equal(first.text, 'answer');
  assert.ok(sizes.some(n => n > windowTokens), 'the fake did overflow before the loop recovered');
  const second = await runAgent(options(server, { context: first.context, input: 'and again', contextWindow: windowTokens, maxTurns: 10 }));
  assert.equal(second.status, 'done', second.error);
  // After two overflows in a row the run still ends with the error instead of looping.
  const hopeless: Provider = { kind: 'openai-compatible', async *stream() { throw new Error('Provider HTTP 400: maximum context length exceeded'); } };
  const failed = await runAgent(options(hopeless, { context, contextWindow: windowTokens, maxTurns: 20 }));
  assert.equal(failed.status, 'error'); assert.match(failed.error!, /maximum context length/);
});

test('run_end warns when the reply is cut at max_tokens', async () => {
  const events: AgentEvent[] = [];
  const r = await runAgent(options(scripted([[{ type: 'text_delta', text: 'half a sentence and' }, { ...done, stopReason: 'max_tokens' }]]), { onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done'); assert.match(r.warning!, /max_tokens/);
  assert.deepEqual(events.at(-1), { type: 'run_end', status: 'done', text: 'half a sentence and', warning: r.warning });
  // A cut that the model recovers from on the next turn is not worth a note.
  const recovered = await runAgent(options(scripted([[{ type: 'text_delta', text: 'cut' }, call('a'), { ...done, stopReason: 'max_tokens' }], [{ type: 'text_delta', text: 'whole answer' }, done]])));
  assert.equal(recovered.status, 'done'); assert.equal(recovered.warning, undefined);
});

test('run_end warns on an empty reply', async () => {
  const events: AgentEvent[] = [];
  const r = await runAgent(options(scripted([[done]]), { onEvent: e => events.push(e) }));
  assert.equal(r.status, 'done'); assert.equal(r.text, ''); assert.match(r.warning!, /empty reply/);
  assert.equal((events.at(-1) as { warning?: string }).warning, r.warning);
  const afterTools = await runAgent(options(scripted([[call('a'), { ...done, stopReason: 'tool_use' }], [{ type: 'text_delta', text: '  ' }, done]])));
  assert.match(afterTools.warning!, /empty reply/); // blank text counts as empty
  assert.equal((await runAgent(options(scripted([[{ type: 'text_delta', text: 'hi' }, done]])))).warning, undefined);
});

test('onMessage reports each finished step as it happens, not the input and not a delegate', async () => {
  const seen: string[] = [];
  const delegating: Tool = { ...echo, name: 'delegate', async run(_, ctx) { return { content: await ctx.delegate!('sub task') }; } };
  const p = scripted([[call('d', 'delegate'), { ...done, stopReason: 'tool_use' }], [{ type: 'text_delta', text: 'sub answer' }, done], [{ type: 'text_delta', text: 'final' }, done]]);
  const r = await runAgent(options(p, { tools: [delegating, echo], onMessage: m => seen.push(`${m.role}:${m.content.map(b => b.type).join('+')}`) }));
  assert.equal(r.status, 'done');
  assert.deepEqual(seen, ['assistant:tool_use', 'user:tool_result', 'assistant:text']);
  assert.deepEqual(r.added.slice(1).map(m => `${m.role}:${m.content.map(b => b.type).join('+')}`), seen); // exactly the messages `added` holds after the input
});
