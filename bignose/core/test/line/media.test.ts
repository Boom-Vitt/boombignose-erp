import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
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

async function gateway(t: { after(fn: () => void): void }, enabled: boolean) {
  const dir = tmp(t), { fetchImpl, reqs } = fakeFetch();
  const config: LineConfig = { enabled, port: 0, slowResponseMs: 45_000, allow: { users: [OWNER], groups: [GROUP], rooms: [] } };
  const got: MediaRecord[] = [];
  const gw = createLineGateway({
    config, channelSecret: SECRET, accessToken: TOKEN, fetchImpl, onMessage: async () => 'x',
    media: { dir, extract: { image: async () => 'ocr text' } }, onMedia: (r) => got.push(r),
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
  return { dir, reqs, got, post, waitFor };
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

test('gateway: with LINE disabled media is still stored but nothing is replied or pushed; strangers are ignored', async (t) => {
  const s = await gateway(t, false);
  await s.post([groupImage('777'), { ...groupImage('888'), source: { type: 'group', groupId: 'C9999999999999999999999999999999', userId: OWNER } }]);
  await s.waitFor(() => s.got.length === 1);
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(s.reqs.map((r) => r.url), ['https://api-data.line.me/v2/bot/message/777/content']);
  assert.equal(s.got.length, 1);
});
