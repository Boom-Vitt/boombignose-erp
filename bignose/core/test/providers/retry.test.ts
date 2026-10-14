import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/providers/index.ts';
import type { ProviderConfig } from '../../src/types.ts';
import { streamed, request, collect } from './helpers.ts';

const openaiCfg: ProviderConfig = { id: 'o', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1' };
const anthropicCfg: ProviderConfig = { id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid' };
const okOpenai = () => streamed('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
const okAnthropic = () => streamed('data: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"ok"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\ndata: {"type":"message_stop"}\n\n');
const reset = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`read ${code}`), { code }) });

/** A fetch that plays the steps in order, repeating the last one, and counts attempts. */
function script(steps: Array<() => Response | Promise<Response>>) {
  const state = { attempts: 0 };
  const fetchImpl = (async () => steps[Math.min(state.attempts++, steps.length - 1)]!()) as typeof fetch;
  return { fetchImpl, state };
}
function fakeSleep() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => { delays.push(ms); } };
}

test('retries 429, 500, 502, 503 and 529 with backoff', async () => {
  for (const [cfg, ok] of [[openaiCfg, okOpenai], [anthropicCfg, okAnthropic]] as const) {
    for (const status of [429, 500, 502, 503, 529]) {
      const { fetchImpl, state } = script([() => new Response('{"error":{"message":"busy"}}', { status }), () => new Response('busy', { status }), ok]);
      const { delays, sleep } = fakeSleep();
      const events = await collect(createProvider(cfg, undefined, fetchImpl, { sleep }).stream(request));
      assert.equal(events.at(-1)?.type, 'done', `${cfg.kind} ${status}`);
      assert.equal(state.attempts, 3, `${cfg.kind} ${status}`);
      assert.deepEqual(delays, [500, 1000], `${cfg.kind} ${status}: backoff doubles`);
    }
  }
});

test('retry honours Retry-After, stays bounded and skips permanent errors', async () => {
  const after = script([() => new Response('slow down', { status: 429, headers: { 'Retry-After': '2' } }), okOpenai]);
  const first = fakeSleep();
  await collect(createProvider(openaiCfg, undefined, after.fetchImpl, { sleep: first.sleep }).stream(request));
  assert.deepEqual(first.delays, [2000]);

  const long = script([() => new Response('quota', { status: 429, headers: { 'Retry-After': '3600' } }), okOpenai]);
  await assert.rejects(collect(createProvider(openaiCfg, undefined, long.fetchImpl, { sleep: fakeSleep().sleep }).stream(request)), /429/);
  assert.equal(long.state.attempts, 1, 'a Retry-After beyond the cap fails at once');

  const always = script([() => new Response('down', { status: 503 })]);
  const bounded = fakeSleep();
  await assert.rejects(collect(createProvider(openaiCfg, undefined, always.fetchImpl, { sleep: bounded.sleep }).stream(request)), /503/);
  assert.equal(always.state.attempts, 4); assert.equal(bounded.delays.length, 3);

  for (const status of [400, 401, 404]) {
    const permanent = script([() => new Response('no', { status }), okOpenai]);
    await assert.rejects(collect(createProvider(openaiCfg, undefined, permanent.fetchImpl, { sleep: fakeSleep().sleep }).stream(request)), new RegExp(String(status)));
    assert.equal(permanent.state.attempts, 1, `${status} is not retried`);
  }
});

test('retry waits can be aborted', async () => {
  const { fetchImpl, state } = script([() => new Response('busy', { status: 503 }), okOpenai]);
  const controller = new AbortController();
  const stream = createProvider(openaiCfg, undefined, fetchImpl, { baseMs: 60_000, maxMs: 60_000 }).stream({ ...request, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  const started = Date.now();
  await assert.rejects(collect(stream), e => e === controller.signal.reason, 'the abort, not the 503, ends the run');
  assert.ok(Date.now() - started < 5000, 'abort ends the backoff wait');
  assert.equal(state.attempts, 1);
});

test('retries a socket reset before any output', async () => {
  for (const [cfg, ok] of [[openaiCfg, okOpenai], [anthropicCfg, okAnthropic]] as const) {
    const refused = script([() => { throw reset('ECONNREFUSED'); }, () => { throw reset('ECONNRESET'); }, ok]);
    assert.equal((await collect(createProvider(cfg, undefined, refused.fetchImpl, { sleep: fakeSleep().sleep }).stream(request))).at(-1)?.type, 'done');
    assert.equal(refused.state.attempts, 3);

    const cut = () => new Response(new ReadableStream({ start(c) { c.error(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) })); } }));
    const midway = script([cut, ok]);
    assert.equal((await collect(createProvider(cfg, undefined, midway.fetchImpl, { sleep: fakeSleep().sleep }).stream(request))).at(-1)?.type, 'done');
    assert.equal(midway.state.attempts, 2);
  }
});

test('does not retry after output has streamed', async () => {
  const half = () => {
    const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"half"}}]}\n\n');
    let sent = false;
    return new Response(new ReadableStream({ pull(c) {
      if (!sent) { sent = true; c.enqueue(bytes); return; }
      c.error(Object.assign(new TypeError('terminated'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }));
    } }));
  };
  const { fetchImpl, state } = script([half, okOpenai]);
  const seen: string[] = [];
  await assert.rejects((async () => { for await (const e of createProvider(openaiCfg, undefined, fetchImpl, { sleep: fakeSleep().sleep }).stream(request)) seen.push(e.type); })(), /closed/i);
  assert.deepEqual(seen, ['text_delta']);
  assert.equal(state.attempts, 1);
});
