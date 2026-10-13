import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SseParser, sseData, streamEvents } from '../src/sse.ts';

const all = (chunks: string[]) => {
  const p = new SseParser();
  return chunks.flatMap((c) => p.push(c));
};

test('parses data frames separated by blank lines', () => {
  assert.deepEqual(all(['data: {"a":1}\n\ndata: {"b":2}\n\n']), ['{"a":1}', '{"b":2}']);
});

test('handles CRLF and bare CR line endings', () => {
  assert.deepEqual(all(['data: one\r\n\r\ndata: two\r\rdata: three\n\n']), ['one', 'two', 'three']);
});

test('joins multi-line data with a newline', () => {
  assert.deepEqual(all(['data: a\ndata: b\n\n']), ['a\nb']);
});

test('ignores comments, pings and other fields', () => {
  assert.deepEqual(all([': ping\n\nevent: x\nid: 7\nretry: 5\ndata: ok\n\n']), ['ok']);
});

test('strips only one leading space and keeps empty data', () => {
  assert.deepEqual(all(['data:  two\n\ndata:\n\n']), [' two', '']);
});

test('drops a leading BOM', () => {
  assert.deepEqual(all(['﻿data: x\n\n']), ['x']);
});

test('a frame split across chunks comes out once it is complete', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: {"te'), []);
  assert.deepEqual(p.push('xt":"hi"}\n'), []);
  assert.deepEqual(p.push('\n'), ['{"text":"hi"}']);
});

test('a CRLF split between chunks is one line break', () => {
  const p = new SseParser();
  assert.deepEqual(p.push('data: a\r'), []);
  assert.deepEqual(p.push('\n\r\n'), ['a']);
});

test('any chunk boundary gives the same result as one big chunk', () => {
  const text = ': hi\r\ndata: {"x":"ไทย"}\r\n\r\ndata: 1\ndata: 2\n\n\ndata: cr\r\rdata: end\n\n';
  const whole = all([text]);
  assert.deepEqual(whole, ['{"x":"ไทย"}', '1\n2', 'cr', 'end']);
  for (let i = 0; i <= text.length; i++) assert.deepEqual(all([text.slice(0, i), text.slice(i)]), whole);
  assert.deepEqual(all([...text]), whole);
});

test('an unfinished frame at the end is not delivered', () => {
  assert.deepEqual(all(['data: done\n\ndata: partial']), ['done']);
});

function bodyOf(bytes: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(c) { for (const b of bytes) c.enqueue(b); c.close(); },
  });
}

test('sseData decodes a multi-byte character split across chunks', async () => {
  const bytes = new TextEncoder().encode('data: สวัสดี\n\n');
  const cut = 8; // inside the first Thai character
  const got: string[] = [];
  for await (const d of sseData(bodyOf([bytes.slice(0, cut), bytes.slice(cut)]))) got.push(d);
  assert.deepEqual(got, ['สวัสดี']);
});

const frames = (...d: string[]) => bodyOf([new TextEncoder().encode(d.map((x) => `data: ${x}\n\n`).join(''))]);

test('streamEvents reconnects after a failure and after the stream ends', async () => {
  const ctl = new AbortController();
  const data: string[] = [];
  const states: boolean[] = [];
  const delays: number[] = [];
  let opens = 0;
  await streamEvents(
    async () => {
      opens++;
      if (opens === 1) throw new Error('refused');
      if (opens === 2) return new Response(frames('a', 'b'), { status: 200 });
      ctl.abort();
      throw new Error('aborted');
    },
    { onData: (d) => data.push(d), onState: (s) => states.push(s) },
    ctl.signal,
    async (ms) => { delays.push(ms); },
  );
  assert.deepEqual(data, ['a', 'b']);
  assert.deepEqual(states, [false, true, false]);
  assert.deepEqual(delays, [1000, 1000]);
});

test('streamEvents backs off up to 15 s and treats a non-2xx as a failure', async () => {
  const ctl = new AbortController();
  const delays: number[] = [];
  await streamEvents(
    async () => new Response('nope', { status: 401 }),
    { onData: () => assert.fail('no data expected'), onState: () => {} },
    ctl.signal,
    async (ms) => { delays.push(ms); if (delays.length === 7) ctl.abort(); },
  );
  assert.deepEqual(delays, [1000, 2000, 4000, 8000, 15000, 15000, 15000]);
});
