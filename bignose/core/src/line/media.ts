// LINE media pipeline: download a message's content, keep it on disk, extract what we can, and append a record to the
// learning store (records.jsonl). Never sends anything to LINE; the gateway decides about acknowledgements.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { appendFileSync, createWriteStream, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, extname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type MediaKind = 'image' | 'video' | 'audio' | 'file';
export type SourceType = 'user' | 'group' | 'room'; // OA DM, group, multi-person chat

export interface MediaEvent {
  messageId: string; kind: MediaKind; sourceType: SourceType; sourceId: string; userId: string;
  timestamp?: number; fileName?: string;
}
export interface MediaRecord extends MediaEvent {
  receivedAt: number; path?: string; contentType?: string; bytes?: number;
  text?: string;                      // OCR / caption for images
  metadata?: Record<string, unknown>; // ffprobe summary for video/audio
  keyframes?: string[];               // jpg paths for video
  error?: string;
}
export interface MediaExtractors {
  image?: (path: string) => Promise<string | undefined>;
  video?: (path: string, outBase: string) => Promise<{ metadata?: Record<string, unknown>; keyframes?: string[] }>;
  audio?: (path: string) => Promise<{ metadata?: Record<string, unknown> }>;
}
export interface MediaOptions {
  dir: string;                 // e.g. ~/.bignose/line-media
  dataApiBase?: string;        // default https://api-data.line.me
  maxBytes?: number;
  extract?: MediaExtractors;   // defaults: tesseract / ffprobe + ffmpeg when installed
}

const MAX_BYTES = 300 * 1024 * 1024; // LINE caps files at 300 MB
const SAFE_ID = /^[A-Za-z0-9]{1,64}$/;  // message, user, group and room IDs are alphanumeric
const EXT: Record<string, string> = {
  'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp',
  'video/mp4': '.mp4', 'video/quicktime': '.mov', 'audio/m4a': '.m4a', 'audio/x-m4a': '.m4a', 'audio/mp4': '.m4a', 'audio/mpeg': '.mp3',
};
const DEFAULT_EXT: Record<MediaKind, string> = { image: '.jpg', video: '.mp4', audio: '.m4a', file: '.bin' };

/** Runs a tool; resolves undefined when it is not installed or fails. */
function run(cmd: string, args: string[], timeout = 60_000): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout) => resolve(err ? undefined : stdout));
  });
}

// shortcut: tesseract default language (eng) only; install tesseract-lang and pass `-l tha+eng` for Thai.
// TODO: when tesseract is missing, plug in a caption model here (stub returns no text).
export async function tesseractOcr(path: string): Promise<string | undefined> {
  return (await run('tesseract', [path, 'stdout']))?.trim() || undefined;
}

export async function ffprobeMetadata(path: string): Promise<Record<string, unknown> | undefined> {
  const out = await run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', path]);
  if (!out) return undefined;
  try {
    const j = JSON.parse(out) as { format?: Record<string, string>; streams?: Record<string, unknown>[] };
    const video = j.streams?.find((s) => s.codec_type === 'video'), audio = j.streams?.find((s) => s.codec_type === 'audio');
    return {
      duration: j.format?.duration ? Number(j.format.duration) : undefined, formatName: j.format?.format_name,
      width: video?.width, height: video?.height, videoCodec: video?.codec_name, audioCodec: audio?.codec_name,
    };
  } catch { return undefined; }
}

/** Up to 5 I-frames as jpg next to the video; [] when ffmpeg is missing or fails. */
export async function ffmpegKeyframes(path: string, outBase: string): Promise<string[]> {
  const pattern = `${outBase}-kf-%02d.jpg`;
  const ok = await run('ffmpeg', ['-v', 'error', '-y', '-i', path, '-vf', "select='eq(pict_type,I)'", '-fps_mode', 'vfr', '-frames:v', '5', pattern], 120_000);
  if (ok === undefined) return [];
  const base = basename(outBase), dir = dirname(outBase);
  return readdirSync(dir).filter((f) => f.startsWith(`${base}-kf-`)).sort().map((f) => join(dir, f));
}

const defaultExtractors: Required<MediaExtractors> = {
  image: tesseractOcr,
  video: async (path, outBase) => ({ metadata: await ffprobeMetadata(path), keyframes: await ffmpegKeyframes(path, outBase) }),
  audio: async (path) => ({ metadata: await ffprobeMetadata(path) }), // TODO: speech-to-text hook
};

function extFor(ev: MediaEvent, contentType: string | undefined): string {
  const fromName = ev.fileName ? extname(ev.fileName).toLowerCase() : '';
  if (/^\.[a-z0-9]{1,8}$/.test(fromName)) return fromName;
  return EXT[contentType?.split(';')[0]!.trim().toLowerCase() ?? ''] ?? DEFAULT_EXT[ev.kind]; // media types are case-insensitive
}

/**
 * Downloads, stores and extracts one media message, then appends its record to `<dir>/records.jsonl`.
 * Always resolves with the record (failures land in `error`) so a bad message never loses the event.
 */
export async function ingestMedia(
  ev: MediaEvent, o: MediaOptions & { accessToken: string; fetchImpl?: typeof fetch; signal?: AbortSignal; now?: () => number },
): Promise<MediaRecord> {
  const record: MediaRecord = { ...ev, receivedAt: (o.now ?? Date.now)() };
  try {
    // trust boundary: these IDs come from the webhook body and become path segments
    if (!SAFE_ID.test(ev.messageId) || !SAFE_ID.test(ev.sourceId) || !['user', 'group', 'room'].includes(ev.sourceType)) throw new Error('invalid media event ids');
    const base = (o.dataApiBase ?? 'https://api-data.line.me').replace(/\/+$/, '');
    const res = await (o.fetchImpl ?? fetch)(`${base}/v2/bot/message/${ev.messageId}/content`, {
      headers: { Authorization: `Bearer ${o.accessToken}` }, redirect: 'error',
      signal: o.signal ? AbortSignal.any([o.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000),
    });
    // shortcut: a 202 (video/audio still transcoding at LINE) is recorded as an error, not retried; poll /content/transcoding if it shows up.
    if (res.status !== 200 || !res.body) throw new Error(`content download failed: ${res.status}`);
    const max = o.maxBytes ?? MAX_BYTES;
    const declared = Number(res.headers.get('content-length') ?? NaN);
    if (declared > max) throw new Error('content too large');

    const contentType = res.headers.get('content-type') ?? undefined;
    const dir = join(o.dir, ev.sourceType, ev.sourceId);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stem = `${ev.timestamp ?? record.receivedAt}-${ev.messageId}`;
    const path = join(dir, stem + extFor(ev, contentType));
    const part = `${path}.${randomBytes(4).toString('hex')}.part`;
    let bytes = 0;
    const limit = new Transform({
      transform(chunk: Buffer, _enc, cb) { bytes += chunk.length; cb(bytes > max ? new Error('content too large') : null, chunk); },
    });
    try {
      await pipeline(Readable.fromWeb(res.body as import('node:stream/web').ReadableStream), limit, createWriteStream(part, { mode: 0o600 }));
      if (bytes === 0) throw new Error('empty content'); // never store or acknowledge a 0-byte message
      // a connection closed early ends the stream cleanly; only a decoded (content-encoded) body may differ in size
      if (Number.isInteger(declared) && !res.headers.get('content-encoding') && bytes !== declared) throw new Error('content truncated');
      renameSync(part, path);
    } catch (e) { rmSync(part, { force: true }); throw e; }
    Object.assign(record, { path, contentType, bytes });

    const x = { ...defaultExtractors, ...o.extract };
    if (ev.kind === 'image') record.text = await x.image(path);
    else if (ev.kind === 'video') Object.assign(record, await x.video(path, join(dir, stem)));
    else if (ev.kind === 'audio') Object.assign(record, await x.audio(path));
  } catch (e) {
    record.error = (e instanceof Error ? e.message : String(e)).replaceAll(o.accessToken, '***').slice(0, 300);
  }
  try {
    mkdirSync(o.dir, { recursive: true, mode: 0o700 });
    appendFileSync(join(o.dir, 'records.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 });
  } catch (e) { // keep the always-resolves contract: the caller still gets the event, and no "saved" ack goes out
    record.error ??= `record not saved: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300);
  }
  return record;
}
