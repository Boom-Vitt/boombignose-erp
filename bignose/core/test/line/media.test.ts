import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLineGateway } from '../../src/line/index.ts';
import type { MediaRecord } from '../../src/line/index.ts';
import { ffprobeMetadata, ingestMedia } from '../../src/line/media.ts';
import type { MediaEvent } from '../../src/line/media.ts';
import type { LineConfig } from '../../src/types.ts';

const TOKEN = 'test-access-token';
const SECRET = 'test-channel-secret';
const OWNER = 'U1111111111111111111111111111111';
const GROUP = 'C3333333333333333333333333333333';

function tmp(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), 'bignose-media-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

interface Req { url: string; method: string; auth?: string; body?: string }
function fakeFetch(content: { status?: number; bytes?: Buffer; type?: string } = {}) {
  const reqs: Req[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    reqs.push({ url, method: init.method ?? 'GET', auth: headers.Authorization, body: init.body as string | undefined });
    if (url.includes('/content')) {
      const bytes = content.bytes ?? Buffer.from('fake-bytes');
      return new Response(content.status === 404 ? 'nope' : new Uint8Array(bytes), {
        status: content.status ?? 200, headers: { 'content-type': content.type ?? 'image/png' },
      });
    }
    return new Response('{}');
  }) as unknown as typeof fetch;
  return { fetchImpl, reqs };
}

const records = (dir: string): MediaRecord[] =>
  readFileSync(join(dir, 'records.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

const imageEvent: MediaEvent = { messageId: '1001', kind: 'image', sourceType: 'user', sourceId: OWNER, userId: OWNER, timestamp: 1700000000000 };

test('image: downloads with the bearer token, stores per source, runs the OCR hook, appends a record', async (t) => {
  const dir = tmp(t), { fetchImpl, reqs } = fakeFetch({ bytes: Buffer.from('PNGDATA'), type: 'image/png' });
  const r = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl, extract: { image: async () => 'invoice #42' } });

  assert.equal(reqs.length, 1);
  assert.equal(reqs[0]!.url, 'https://api-data.line.me/v2/bot/message/1001/content');
  assert.equal(reqs[0]!.auth, `Bearer ${TOKEN}`);
  assert.equal(r.error, undefined);
  assert.equal(r.path, join(dir, 'user', OWNER, '1700000000000-1001.png'));
  assert.equal(readFileSync(r.path!, 'utf8'), 'PNGDATA');
  assert.equal(r.bytes, 7);
  assert.equal(r.text, 'invoice #42');
  assert.deepEqual(records(dir), [JSON.parse(JSON.stringify(r))]);
  assert.equal(records(dir)[0]!.sourceType, 'user');
});

test('video in a group: metadata and keyframes from the extractor; file name extension wins for files', async (t) => {
  const dir = tmp(t), { fetchImpl } = fakeFetch({ type: 'video/mp4' });
  const r = await ingestMedia({ ...imageEvent, messageId: '2002', kind: 'video', sourceType: 'group', sourceId: GROUP }, {
    dir, accessToken: TOKEN, fetchImpl,
    extract: { video: async (_p, outBase) => ({ metadata: { duration: 3.5 }, keyframes: [`${outBase}-kf-01.jpg`] }) },
  });
  assert.equal(r.path, join(dir, 'group', GROUP, '1700000000000-2002.mp4'));
  assert.deepEqual(r.metadata, { duration: 3.5 });
  assert.deepEqual(r.keyframes, [join(dir, 'group', GROUP, '1700000000000-2002-kf-01.jpg')]);

  const f = await ingestMedia({ ...imageEvent, messageId: '3003', kind: 'file', fileName: 'quote.PDF' }, { dir, accessToken: TOKEN, fetchImpl: fakeFetch({ type: 'application/octet-stream' }).fetchImpl });
  assert.ok(f.path!.endsWith('-3003.pdf'));
  assert.equal(records(dir).length, 2);
});

test('unsafe ids are rejected before any request; failures are recorded, nothing half-written is left', async (t) => {
  const dir = tmp(t), { fetchImpl, reqs } = fakeFetch();
  const bad = await ingestMedia({ ...imageEvent, sourceId: '../../etc' }, { dir, accessToken: TOKEN, fetchImpl });
  assert.match(bad.error!, /invalid/);
  assert.equal(reqs.length, 0);

  const missing = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl: fakeFetch({ status: 404 }).fetchImpl });
  assert.match(missing.error!, /404/);
  assert.equal(missing.path, undefined);

  const big = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, maxBytes: 4, fetchImpl: fakeFetch({ bytes: Buffer.alloc(10) }).fetchImpl });
  assert.match(big.error!, /too large/);
  assert.deepEqual(readdirSync(join(dir, 'user', OWNER)), [], 'no .part file left behind');
  assert.equal(records(dir).length, 3);
});

test('default extractors fall back gracefully when the input is unusable', async () => {
  assert.equal(await ffprobeMetadata('/nonexistent/clip.mp4'), undefined);
});

// ---- gateway

async function gateway(t: { after(fn: () => void): void }, enabled: boolean, o: { fetchImpl?: typeof fetch; noMedia?: boolean } = {}) {
  const dir = tmp(t), fake = fakeFetch(), reqs = fake.reqs;
  const config: LineConfig = { enabled, port: 0, slowResponseMs: 45_000, allow: { users: [OWNER], groups: [GROUP], rooms: [] } };
  const got: MediaRecord[] = [];
  const gw = createLineGateway({
    config, channelSecret: SECRET, accessToken: TOKEN, fetchImpl: o.fetchImpl ?? fake.fetchImpl, onMessage: async () => 'x',
    media: o.noMedia ? undefined : { dir, extract: { image: async () => 'ocr text' } }, onMedia: (r) => got.push(r),
  });
  const port = await gw.listen(0);
  t.after(() => gw.close());
  const post = async (events: unknown[]) => {
    const body = JSON.stringify({ events });
    const sig = createHmac('sha256', SECRET).update(body).digest('base64');
    const res = await fetch(`http://127.0.0.1:${port}/line/webhook`, { method: 'POST', body, headers: { 'x-line-signature': sig } });
    assert.equal(res.status, 200);
  };
  const waitFor = async (cond: () => boolean) => {
    for (let i = 0; i < 400 && !cond(); i++) await new Promise((r) => setTimeout(r, 5));
    assert.ok(cond(), 'timed out');
  };
  return { gw, dir, reqs, got, post, waitFor };
}

const groupImage = (id: string) => ({
  type: 'message', webhookEventId: `e${id}`, replyToken: `rt${id}`, timestamp: 1700000000000,
  source: { type: 'group', groupId: GROUP, userId: OWNER }, message: { type: 'image', id },
});

test('gateway: an allowed group image is stored with source type, user and OCR text, then acknowledged', async (t) => {
  const s = await gateway(t, true);
  await s.post([groupImage('555')]);
  await s.waitFor(() => s.reqs.some((r) => r.url.endsWith('/message/reply')));
  assert.equal(s.got.length, 1);
  assert.equal(s.got[0]!.sourceType, 'group');
  assert.equal(s.got[0]!.sourceId, GROUP);
  assert.equal(s.got[0]!.userId, OWNER);
  assert.equal(s.got[0]!.text, 'ocr text');
  assert.ok(existsSync(s.got[0]!.path!));
  assert.equal(records(s.dir).length, 1);
});

test('gateway: three photos in one webhook are each acknowledged with their own free reply, never a push', async (t) => {
  const s = await gateway(t, true);
  await s.post([groupImage('601'), groupImage('602'), groupImage('603')]);
  const sends = () => s.reqs.filter((r) => r.url.endsWith('/message/reply') || r.url.endsWith('/message/push'));
  await s.waitFor(() => sends().length === 3);
  assert.equal(s.reqs.filter((r) => r.url.endsWith('/message/push')).length, 0);
  assert.equal(new Set(sends().map((r) => JSON.parse(r.body!).replyToken)).size, 3, 'each event spends its own token');
});

test('gateway: with LINE disabled media is still stored but nothing is replied or pushed; strangers are ignored', async (t) => {
  const s = await gateway(t, false);
  await s.post([groupImage('777'), { ...groupImage('888'), source: { type: 'group', groupId: 'C9999999999999999999999999999999', userId: OWNER } }]);
  await s.waitFor(() => s.got.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.reqs.map((r) => r.url), ['https://api-data.line.me/v2/bot/message/777/content']);
  assert.equal(s.got.length, 1);
});

// ---- edge cases: content type, size, failures, path safety

/** A content fetch that hands back `make()`'s response and keeps every request's init. */
function contentFetch(make: (init: RequestInit) => Response | Promise<Response>) {
  const inits: { url: string; init: RequestInit }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => { inits.push({ url, init }); return make(init); }) as unknown as typeof fetch;
  return { fetchImpl, inits };
}
const bytesResponse = (headers: Record<string, string> = {}, body: Uint8Array<ArrayBuffer> | null = new TextEncoder().encode('data'), status = 200) =>
  new Response(body, { status, headers });
/** A body that sends `first`, then fails (a connection cut mid-download). */
const brokenBody = (first: string) => new ReadableStream<Uint8Array>({
  start(c) { c.enqueue(new TextEncoder().encode(first)); c.error(new Error('socket hang up')); },
});
const leftovers = (dir: string) => existsSync(join(dir, 'user', OWNER)) ? readdirSync(join(dir, 'user', OWNER)) : [];

test('content type: parameters and case are ignored; unknown or missing types fall back to the kind default', async (t) => {
  const dir = tmp(t);
  const ingest = (headers: Record<string, string>, ev: Partial<MediaEvent>) =>
    ingestMedia({ ...imageEvent, ...ev }, { dir, accessToken: TOKEN, fetchImpl: contentFetch(() => bytesResponse(headers)).fetchImpl, extract: { image: async () => undefined, video: async () => ({}), audio: async () => ({}) } });

  const withParam = await ingest({ 'content-type': 'image/jpeg; charset=binary' }, { messageId: '11' });
  assert.ok(withParam.path!.endsWith('-11.jpg'));
  assert.equal(withParam.contentType, 'image/jpeg; charset=binary', 'the raw header is recorded');
  assert.ok((await ingest({ 'content-type': 'IMAGE/PNG' }, { messageId: '12' })).path!.endsWith('-12.png'));
  assert.ok((await ingest({ 'content-type': 'audio/mpeg' }, { messageId: '13', kind: 'audio' })).path!.endsWith('-13.mp3'));
  assert.ok((await ingest({ 'content-type': 'application/x-unknown' }, { messageId: '14', kind: 'audio' })).path!.endsWith('-14.m4a'));
  const noType = await ingest({}, { messageId: '15', kind: 'video' });
  assert.ok(noType.path!.endsWith('-15.mp4'));
  assert.equal(noType.contentType, undefined);
  assert.ok((await ingest({}, { messageId: '16', kind: 'file' })).path!.endsWith('-16.bin'));
});

test('file names only lend a short alphanumeric extension; traversal in the name never leaves the source folder', async (t) => {
  const dir = tmp(t), src = join(dir, 'user', OWNER);
  const ingest = (messageId: string, fileName: string) => ingestMedia({ ...imageEvent, messageId, kind: 'file', fileName },
    { dir, accessToken: TOKEN, fetchImpl: contentFetch(() => bytesResponse({ 'content-type': 'image/png' })).fetchImpl });

  assert.equal((await ingest('21', '../../../../tmp/evil.sh')).path, join(src, '1700000000000-21.sh'));
  assert.equal((await ingest('22', 'report.verylongext')).path, join(src, '1700000000000-22.png'), 'over 8 chars: content type wins');
  assert.equal((await ingest('23', '.env')).path, join(src, '1700000000000-23.png'), 'dotfile has no extension');
  assert.equal((await ingest('24', 'a.p/ng')).path, join(src, '1700000000000-24.png'));
  assert.equal((await ingest('25', 'x.t$t')).path, join(src, '1700000000000-25.png'));
  assert.deepEqual(readdirSync(dir).sort(), ['records.jsonl', 'user']);
  assert.equal(readdirSync(src).length, 5);
});

test('odd ids and source types are refused before any request or folder is made', async (t) => {
  const dir = tmp(t), { fetchImpl, inits } = contentFetch(() => bytesResponse());
  const cases: Partial<MediaEvent>[] = [
    { messageId: '' }, { messageId: '..' }, { messageId: '../1001' }, { messageId: '10/01' }, { messageId: '1001\u0000' },
    { messageId: 'a'.repeat(65) }, { messageId: '１００１' }, { messageId: '1001 ' }, { sourceId: '' }, { sourceId: 'U1/..' },
    { sourceType: 'channel' as MediaEvent['sourceType'] }, { sourceType: '../user' as MediaEvent['sourceType'] },
  ];
  for (const c of cases) {
    const r = await ingestMedia({ ...imageEvent, ...c }, { dir, accessToken: TOKEN, fetchImpl });
    assert.equal(r.error, 'invalid media event ids', JSON.stringify(c));
    assert.equal(r.path, undefined);
  }
  assert.equal(inits.length, 0);
  assert.deepEqual(readdirSync(dir), ['records.jsonl']);
  assert.equal(records(dir).length, cases.length, 'every refused event is still recorded');
  assert.equal(records(dir)[4]!.messageId, '1001\u0000', 'odd ids round-trip through JSON');
  assert.ok((await ingestMedia({ ...imageEvent, messageId: 'a'.repeat(64) }, { dir, accessToken: TOKEN, fetchImpl, extract: { image: async () => undefined } })).path);
});

test('size: a declared length over the cap is refused before writing; a body exactly at the cap is kept', async (t) => {
  const dir = tmp(t);
  const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(9)); c.close(); } });
  const declared = await ingestMedia(imageEvent, {
    dir, accessToken: TOKEN, maxBytes: 4, fetchImpl: contentFetch(() => new Response(body, { headers: { 'content-length': '5' } })).fetchImpl,
  });
  assert.equal(declared.error, 'content too large');
  assert.equal(existsSync(join(dir, 'user')), false, 'no folder made');

  const exact = await ingestMedia({ ...imageEvent, messageId: '31' }, {
    dir, accessToken: TOKEN, maxBytes: 4, extract: { image: async () => undefined },
    fetchImpl: contentFetch(() => bytesResponse({ 'content-length': 'garbage' })).fetchImpl, // unparsable length: the stream cap decides
  });
  assert.equal(exact.error, undefined);
  assert.equal(exact.bytes, 4);
});

test('download failures: non-200, no body, rejected fetch, cut stream, empty and short bodies are recorded and leave no file', async (t) => {
  const dir = tmp(t);
  const ingest = (messageId: string, make: () => Response | Promise<Response>) =>
    ingestMedia({ ...imageEvent, messageId }, { dir, accessToken: TOKEN, fetchImpl: contentFetch(make).fetchImpl, extract: { image: async () => 'ocr' } });

  assert.equal((await ingest('41', () => bytesResponse({}, null, 202))).error, 'content download failed: 202', 'still transcoding');
  assert.equal((await ingest('42', () => bytesResponse({}, new Uint8Array(1), 500))).error, 'content download failed: 500');
  assert.equal((await ingest('43', () => bytesResponse({}, null))).error, 'content download failed: 200');
  const rejected = await ingest('44', () => Promise.reject(new Error(`401 for Bearer ${TOKEN} ${'x'.repeat(400)}`)));
  assert.ok(!rejected.error!.includes(TOKEN), 'token redacted');
  assert.match(rejected.error!, /^401 for Bearer \*\*\* x+$/);
  assert.equal(rejected.error!.length, 300);

  const cut = await ingest('45', () => new Response(brokenBody('half')));
  assert.equal(cut.error, 'socket hang up');
  assert.equal(cut.path, undefined);
  assert.equal(cut.text, undefined, 'no extractor on a partial file');

  const empty = await ingest('46', () => bytesResponse({ 'content-type': 'image/png' }, new Uint8Array(0)));
  assert.equal(empty.error, 'empty content');
  assert.equal(empty.path, undefined);
  assert.equal(empty.text, undefined);

  const short = await ingest('47', () => bytesResponse({ 'content-length': '10' }));
  assert.equal(short.error, 'content truncated', 'a body that ends before its declared length is not a whole file');
  assert.equal(short.path, undefined);

  assert.deepEqual(leftovers(dir), [], 'no .part or final file left behind');
  assert.equal(records(dir).length, 7);
});

test('abort: the caller signal and a timeout guard the request; aborting mid-stream removes the partial file', async (t) => {
  const dir = tmp(t), ctl = new AbortController();
  const { fetchImpl, inits } = contentFetch((init) => new Response(new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('part'));
      init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
      ctl.abort(new Error('gateway closed'));
    },
  })));
  const r = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl, signal: ctl.signal, extract: { image: async () => 'ocr' } });
  assert.equal(r.error, 'gateway closed');
  assert.equal(inits[0]!.init.redirect, 'error', 'redirects are refused');
  assert.notEqual(inits[0]!.init.signal, ctl.signal, 'caller signal is combined with the timeout');
  assert.deepEqual(leftovers(dir), []);

  const noSignal = contentFetch(() => bytesResponse());
  await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl: noSignal.fetchImpl, dataApiBase: 'http://data.test//', extract: { image: async () => undefined } });
  assert.ok(noSignal.inits[0]!.init.signal instanceof AbortSignal, 'a timeout applies even without a caller signal');
  assert.equal(noSignal.inits[0]!.url, 'http://data.test/v2/bot/message/1001/content');
});

test('stall: a slow download that keeps sending is kept; one that stops sending is cut and leaves no file', async (t) => {
  const dir = tmp(t), sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const drip = (chunks: number, gapMs: number) => contentFetch((init) => new Response(new ReadableStream<Uint8Array>({
    async start(c) {
      init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
      for (let i = 0; i < chunks && !init.signal!.aborted; i++) { await sleep(gapMs); c.enqueue(new TextEncoder().encode('x')); }
      if (!init.signal!.aborted) c.close();
    },
  })));
  const opts = { dir, accessToken: TOKEN, stallMs: 60, extract: { image: async () => undefined } };
  const slow = await ingestMedia(imageEvent, { ...opts, fetchImpl: drip(6, 20).fetchImpl }); // 120 ms in total, never 60 ms idle
  assert.equal(slow.error, undefined);
  assert.equal(slow.bytes, 6);

  const stalled = await ingestMedia({ ...imageEvent, messageId: '1002' }, { ...opts, fetchImpl: drip(1, 150).fetchImpl });
  assert.equal(stalled.error, 'content download stalled');
  assert.deepEqual(leftovers(dir), ['1700000000000-1001.jpg'], 'only the completed download is on disk');
});

test('extraction: a failing extractor keeps the stored file and records the error; files run no extractor', async (t) => {
  const dir = tmp(t);
  const boom = async (): Promise<never> => { throw new Error(`ocr crashed ${TOKEN}`); };
  const fetchImpl = contentFetch(() => bytesResponse({ 'content-type': 'image/png' })).fetchImpl;
  const r = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl, extract: { image: boom } });
  assert.equal(r.error, 'ocr crashed ***');
  assert.ok(existsSync(r.path!), 'downloaded file is kept for a retry');
  assert.equal(r.bytes, 4);

  const f = await ingestMedia({ ...imageEvent, messageId: '51', kind: 'file' }, { dir, accessToken: TOKEN, fetchImpl, extract: { image: boom, video: boom, audio: boom } });
  assert.equal(f.error, undefined);
  assert.equal(f.text, undefined);
  assert.equal(f.metadata, undefined);
});

test('gateway: a failed download is reported to onMedia and status, without the token; nothing is sent', async (t) => {
  const reqs: string[] = [];
  const fetchImpl = (async (url: string) => {
    reqs.push(url);
    return url.includes('/content') ? new Response(null, { status: 410 }) : new Response('{}');
  }) as unknown as typeof fetch;
  const s = await gateway(t, false, { fetchImpl });
  await s.post([groupImage('901')]);
  await s.waitFor(() => s.got.length === 1);
  assert.equal(s.got[0]!.error, 'content download failed: 410');
  assert.equal(s.gw.status().lastError, 'LINE media 901: content download failed: 410');
  assert.deepEqual(reqs, ['https://api-data.line.me/v2/bot/message/901/content']);
  assert.equal(records(s.dir)[0]!.error, 'content download failed: 410');
});

test('gateway: stickers, locations, media without a string id, and media with no store configured download nothing', async (t) => {
  const s = await gateway(t, false);
  const ev = (id: string, message: Record<string, unknown>) => ({ ...groupImage(id), message });
  await s.post([
    ev('61', { type: 'sticker', id: '61', packageId: '1', stickerId: '1' }), ev('62', { type: 'location', id: '62' }),
    ev('63', { type: 'image', id: 63 }), ev('64', { type: 'image' }), groupImage('../65'),
  ]);
  await s.waitFor(() => s.got.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.reqs, [], 'only the unsafe id reached ingest, and it was refused before any request');
  assert.equal(s.got[0]!.error, 'invalid media event ids');

  const off = await gateway(t, false, { noMedia: true });
  await off.post([groupImage('66')]);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(off.reqs.length, 0);
  assert.equal(off.got.length, 0);
});

test('gateway: closing aborts an in-flight download and leaves no partial file', async (t) => {
  let started!: () => void;
  const begun = new Promise<void>((r) => { started = r; });
  const fetchImpl = (async (_url: string, init: RequestInit) => new Response(new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode('part'));
      init.signal!.addEventListener('abort', () => c.error(init.signal!.reason));
      started();
    },
  }))) as unknown as typeof fetch;
  const s = await gateway(t, false, { fetchImpl });
  await s.post([groupImage('701')]);
  await begun;
  await s.gw.close();
  await s.waitFor(() => s.got.length === 1);
  assert.match(s.got[0]!.error!, /abort/i);
  assert.deepEqual(readdirSync(join(s.dir, 'group', GROUP)), []);
});

test('declared length: a content-encoded body may differ in size; a plain body longer than declared is refused', async (t) => {
  const dir = tmp(t);
  const ingest = (messageId: string, headers: Record<string, string>) => ingestMedia({ ...imageEvent, messageId },
    { dir, accessToken: TOKEN, fetchImpl: contentFetch(() => bytesResponse(headers)).fetchImpl, extract: { image: async () => undefined } });

  const encoded = await ingest('81', { 'content-length': '2', 'content-encoding': 'gzip' });
  assert.equal(encoded.error, undefined);
  assert.equal(encoded.bytes, 4);
  const long = await ingest('82', { 'content-length': '2' });
  assert.equal(long.error, 'content truncated');
  assert.equal(long.path, undefined);
  assert.deepEqual(leftovers(dir), ['1700000000000-81.jpg']);
});

test('audio: metadata comes from the extractor; a non-Error throw is still recorded as text', async (t) => {
  const dir = tmp(t), fetchImpl = contentFetch(() => bytesResponse({ 'content-type': 'audio/x-m4a' })).fetchImpl;
  const a = await ingestMedia({ ...imageEvent, messageId: '91', kind: 'audio' }, { dir, accessToken: TOKEN, fetchImpl, extract: { audio: async () => ({ metadata: { duration: 2 } }) } });
  assert.ok(a.path!.endsWith('-91.m4a'));
  assert.deepEqual(a.metadata, { duration: 2 });
  const odd = await ingestMedia({ ...imageEvent, messageId: '92' }, { dir, accessToken: TOKEN, fetchImpl, extract: { image: () => Promise.reject('ocr gone') } });
  assert.equal(odd.error, 'ocr gone');
});

test('concurrent: the same message twice and several others at once share one folder and never clash on temp files', async (t) => {
  const dir = tmp(t), fetchImpl = contentFetch(() => bytesResponse({ 'content-type': 'image/png' })).fetchImpl;
  const ids = ['71', '71', '72', '73', '74'];
  const rs = await Promise.all(ids.map((messageId) =>
    ingestMedia({ ...imageEvent, messageId }, { dir, accessToken: TOKEN, fetchImpl, extract: { image: async () => undefined } })));
  assert.deepEqual(rs.map((r) => r.error), ids.map(() => undefined));
  assert.equal(rs[0]!.path, rs[1]!.path, 'a redelivered message lands on the same file');
  assert.deepEqual(leftovers(dir).sort(), ['71', '72', '73', '74'].map((id) => `1700000000000-${id}.png`), 'no .part file left');
  assert.equal(records(dir).length, ids.length);
});

test('record store unwritable: ingest still resolves with the record and an error instead of rejecting', async (t) => {
  const root = tmp(t), fetchImpl = contentFetch(() => bytesResponse({ 'content-type': 'image/png' })).fetchImpl;
  const notDir = join(root, 'not-a-dir');
  writeFileSync(notDir, 'x');
  const blocked = await ingestMedia(imageEvent, { dir: notDir, accessToken: TOKEN, fetchImpl });
  assert.match(blocked.error!, /ENOTDIR/, 'the first failure is the one kept');

  const dir = join(root, 'media');
  mkdirSync(join(dir, 'records.jsonl'), { recursive: true }); // the append target is a folder
  const stored = await ingestMedia(imageEvent, { dir, accessToken: TOKEN, fetchImpl, extract: { image: async () => 'ocr' } });
  assert.match(stored.error!, /^record not saved: EISDIR/);
  assert.ok(existsSync(stored.path!), 'the downloaded file is kept');
});

test('gateway: media downloads run side by side; a stalled file holds up neither another image nor a text run', async (t) => {
  let release!: () => void;
  const stalled = new Promise<void>((r) => { release = r; });
  const sent: string[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    if (url.includes('/801/content')) { await stalled; return new Response('pdf', { headers: { 'content-type': 'application/pdf' } }); }
    if (url.includes('/content')) return new Response('img', { headers: { 'content-type': 'image/png' } });
    sent.push(String(init.body));
    return new Response('{}');
  }) as unknown as typeof fetch;
  const s = await gateway(t, true, { fetchImpl });
  await s.post([
    { ...groupImage('801'), message: { type: 'file', id: '801', fileName: 'quote.pdf' } }, groupImage('802'),
    { ...groupImage('803'), message: { type: 'text', id: '803', text: 'hi' } },
  ]);
  await s.waitFor(() => s.got.length === 1 && sent.length === 2);
  assert.equal(s.got[0]!.messageId, '802');
  assert.ok(sent.some((b) => b.includes('รับรูปแล้ว')), 'image acknowledged while the file is still downloading');

  release();
  await s.waitFor(() => s.got.length === 2 && sent.length === 3);
  assert.equal(s.got[1]!.fileName, 'quote.pdf');
  assert.ok(s.got[1]!.path!.endsWith('-801.pdf'));
  assert.ok(sent[2]!.includes('รับไฟล์แล้ว'));
});

test('gateway: with LINE enabled a failed download is never acknowledged as saved', async (t) => {
  const sent: string[] = [];
  const fetchImpl = (async (url: string) => {
    if (url.includes('/content')) return new Response('oops', { status: 500 });
    sent.push(url);
    return new Response('{}');
  }) as unknown as typeof fetch;
  const s = await gateway(t, true, { fetchImpl });
  await s.post([groupImage('811')]);
  await s.waitFor(() => s.got.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(s.got[0]!.error, 'content download failed: 500');
  assert.deepEqual(sent, []);
});
