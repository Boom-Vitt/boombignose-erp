// LINE Messaging API webhook gateway (design.md section 7). Own 127.0.0.1 server, signature check, allowlists,
// reply-token-first sending with push fallback, slow-response "Get answer" button, confirm-button approvals.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LineConfig } from '../types.ts';
import { ingestMedia } from './media.ts';
import type { MediaKind, MediaOptions, MediaRecord, SourceType } from './media.ts';
export { lineBotInfo, setLineWebhook, lineWebhookActive, testLineWebhook, publicUrlProblem, webhookUrlFor } from './connect.ts';
export type { LineApiOptions } from './connect.ts';
export type { MediaOptions, MediaRecord } from './media.ts';

const MAX_BODY = 1024 * 1024;        // 1 MiB
const CHUNK = 4500;                  // characters per text message
const MAX_PER_CALL = 5;              // messages per reply/push call
const TOKEN_TTL_MS = 55_000;         // reply tokens last ~60 s
const APPROVAL_TIMEOUT_MS = 10 * 60_000;
const MAX_SEEN = 2000;               // remembered webhookEventIds
const MAX_PENDING = 100;             // remembered slow answers
const CONFIRM_TEXT_MAX = 240;        // LINE limit for a confirm template without title or image
const MAX_TIMER = 2 ** 31 - 1;       // largest setTimeout delay
const WORKING = 'Still working on it. Tap the button to get the answer when it is ready.';

export interface LineGatewayOptions {
  config: LineConfig; channelSecret: string; accessToken: string;
  onMessage: (m: { to: string; userId: string; text: string }, signal: AbortSignal) => Promise<string>; // signal: the gateway closed
  fetchImpl?: typeof fetch;
  apiBase?: string;
  media?: MediaOptions;              // where image/video/audio/file messages are stored; unset = media is ignored
  onMedia?: (r: MediaRecord) => void;
  seen?: Set<string>;
  now?: () => number;
  timers?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
}
export type PendingState = 'PENDING' | 'READY' | 'DELIVERED';
export interface LineStatus {
  running: boolean; port?: number; lastEventAt?: number; lastError?: string;
  pending: { id: string; to: string; state: PendingState }[];
}

type LineMessage = Record<string, unknown>;
interface Source { type?: string; userId?: unknown; groupId?: unknown; roomId?: unknown }
interface LineEvent {
  type?: string; webhookEventId?: unknown; replyToken?: unknown; source?: Source; timestamp?: unknown;
  message?: { type?: string; text?: unknown; id?: unknown; fileName?: unknown }; postback?: { data?: unknown };
}
interface Chat { token?: { value: string; at: number }; queue: (() => Promise<void>)[]; busy: boolean }
interface Pending { id: string; to: string; state: PendingState; text?: string; delivered: number; sending?: boolean }

function chunkText(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length;) {
    let end = Math.min(i + CHUNK, text.length);
    const last = text.charCodeAt(end - 1);
    if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--; // do not split a surrogate pair
    out.push(text.slice(i, end));
    i = end;
  }
  return out;
}

const textMessages = (text: string): LineMessage[] => chunkText(text || '(empty reply)').map((t) => ({ type: 'text', text: t }));

const postback = (label: string, data: string) => ({ type: 'postback', label, data });

export function createLineGateway(options: LineGatewayOptions) {
  const opts = { ...options }; // reconfigure() swaps config and credentials in place, so a settings save never rebuilds the gateway
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = (opts.apiBase ?? 'https://api.line.me').replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? { setTimeout, clearTimeout };

  const seen = opts.seen ?? new Set<string>();
  const chats = new Map<string, Chat>();
  const pendings = new Map<string, Pending>();
  const approvals = new Map<string, { to: string; resolve: (ok: boolean) => void; timer: unknown }>();
  const slowTimers = new Set<unknown>();
  let closed = false;
  const closing = new AbortController();
  let server: Server | undefined, listenPort: number | undefined; // listenPort: the port that was asked for (0 = ephemeral)
  let lastEventAt: number | undefined;
  let lastError: string | undefined;

  const chatOf = (to: string): Chat => {
    let c = chats.get(to);
    if (!c) chats.set(to, (c = { queue: [], busy: false }));
    return c;
  };
  // The live allow list, for work that was queued before a settings save: a chat removed since then gets no run and no answer.
  const stillAllowed = (to: string): boolean => {
    const { users, groups, rooms } = opts.config.allow;
    return users.includes(to) || groups.includes(to) || rooms.includes(to);
  };

  // Keep the last error for status(); never let the channel credentials into it.
  const fail = (e: unknown) => {
    let msg = e instanceof Error ? e.message : String(e);
    for (const secret of [opts.accessToken, opts.channelSecret]) if (secret) msg = msg.replaceAll(secret, '***');
    lastError = msg.slice(0, 300);
  };

  // ---- LINE API

  async function call(path: string, body: unknown): Promise<void> {
    if (closed) return;
    const { accessToken, channelSecret } = opts; // reconfigure() may rotate these while the request is in flight
    const mask = (text: string) => {
      for (const secret of [accessToken, channelSecret, opts.accessToken, opts.channelSecret]) if (secret) text = text.replaceAll(secret, '***');
      return text;
    };
    let res: Response;
    try {
      res = await fetchImpl(`${apiBase}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch (e) { throw new Error(`LINE ${path} failed: ${mask(e instanceof Error ? e.message : String(e))}`); }
    const text = await res.text().catch(() => '');
    if (!res.ok) throw new Error(`LINE ${path} failed: ${res.status} ${mask(text).slice(0, 200)}`);
  }

  /** The chat's latest reply token if it is still young; tokens are single use, so it is dropped either way. */
  function takeToken(to: string): string | undefined {
    const chat = chatOf(to), t = chat.token;
    chat.token = undefined;
    return t && now() - t.at < TOKEN_TTL_MS ? t.value : undefined;
  }

  // At most 5 messages per call. The first call tries the free reply token; if there is none, or LINE refuses it
  // (expired, already used), it goes out as a metered push. Further calls are always pushes.
  // onlyAllowed (every gateway answer and prompt; not push()): stop as soon as the chat leaves the allow list, before each call
  // and before the fallback push. Resolves true when everything was sent, false when it stopped early.
  async function sendMessages(to: string, messages: LineMessage[], pending?: Pending, onlyAllowed = false): Promise<boolean> {
    const start = pending?.delivered ?? 0;
    const stopped = () => closed || (onlyAllowed && !stillAllowed(to));
    for (let i = start; i < messages.length; i += MAX_PER_CALL) {
      if (stopped()) return false;
      const batch = messages.slice(i, i + MAX_PER_CALL);
      const token = i === start ? takeToken(to) : undefined;
      if (token) {
        try {
          await call('/v2/bot/message/reply', { replyToken: token, messages: batch });
          if (pending && !closed) pending.delivered = i + batch.length;
          continue;
        } catch (e) { fail(e); }
      }
      if (stopped()) return false;
      await call('/v2/bot/message/push', { to, messages: batch });
      if (pending && !closed) pending.delivered = i + batch.length;
    }
    return true;
  }
  const send = (to: string, text: string) => sendMessages(to, textMessages(text)).then(() => {}); // push(): cron delivery is not filtered by allow
  const say = (to: string, text: string) => sendMessages(to, textMessages(text), undefined, true);

  const workingMessage = (p: Pending): LineMessage => ({
    type: 'template', altText: WORKING,
    template: { type: 'buttons', text: WORKING, actions: [postback('Get answer', `get:${p.id}`)] },
  });

  // ---- one run per chat, in order

  async function drain(chat: Chat): Promise<void> {
    chat.busy = true;
    while (!closed && chat.queue.length) {
      try { await chat.queue.shift()!(); } catch (e) { fail(e); }
    }
    chat.busy = false;
  }
  function enqueue(to: string, job: () => Promise<void>): void {
    if (closed) return;
    const chat = chatOf(to);
    chat.queue.push(job);
    if (!chat.busy) void drain(chat);
  }

  function remember(p: Pending): void {
    pendings.set(p.id, p);
    if (pendings.size > MAX_PENDING) pendings.delete(pendings.keys().next().value!); // ponytail: oldest answer is forgotten, no expiry timer
  }

  async function runMessage(to: string, userId: string, text: string): Promise<void> {
    if (closed || !stillAllowed(to)) return;
    if (to.startsWith('U')) void call('/v2/bot/chat/loading/start', { chatId: to, loadingSeconds: 60 }).catch(fail);
    const answer = Promise.resolve()
      .then(() => closed ? '' : opts.onMessage({ to, userId, text }, closing.signal))
      .catch((e) => { fail(e); return 'Sorry, something went wrong.'; });
    let timer: unknown;
    const slow = new Promise<null>((resolve) => {
      const ms = opts.config.slowResponseMs; // setTimeout fires at once for NaN or > 2^31-1
      timer = timers.setTimeout(() => resolve(null), ms > 0 ? Math.min(ms, MAX_TIMER) : 45_000);
      slowTimers.add(timer);
    });
    const early = await Promise.race([answer, slow]);
    slowTimers.delete(timer);
    if (early !== null) timers.clearTimeout(timer);
    if (closed || !stillAllowed(to)) return;
    if (early !== null) {
      await say(to, early);
      return;
    }
    // Too slow for the reply token: park the answer behind a "Get answer" button.
    const pending: Pending = { id: randomBytes(6).toString('hex'), to, state: 'PENDING', delivered: 0 };
    remember(pending);
    try { if (!await sendMessages(to, [workingMessage(pending)], undefined, true)) { pendings.delete(pending.id); return; } } catch (e) {
      fail(e);
      pendings.delete(pending.id);
      await say(to, await answer);
      return;
    }
    pending.text = await answer;
    pending.state = 'READY';
  }

  // ---- taps and approvals

  function settleApproval(id: string, ok: boolean): void {
    const a = approvals.get(id);
    if (!a) return;
    approvals.delete(id);
    timers.clearTimeout(a.timer);
    a.resolve(ok);
  }

  function askApproval(to: string, text: string): Promise<boolean> {
    if (closed || !stillAllowed(to)) return Promise.resolve(false); // nobody in a removed chat could answer, so do not show it the prompt
    const id = randomBytes(6).toString('hex');
    // The confirm template only fits 240 characters. Longer prompts go out in full first, so the owner always
    // sees the whole command before tapping Allow.
    const long = text.length > CONFIRM_TEXT_MAX;
    const body = long ? 'Allow the action described above?' : text;
    const messages: LineMessage[] = [
      ...(long ? textMessages(text) : []),
      {
        type: 'template', altText: text.slice(0, 400),
        template: { type: 'confirm', text: body, actions: [postback('Allow', `approve:${id}`), postback('Deny', `deny:${id}`)] },
      },
    ];
    return new Promise<boolean>((resolve) => {
      approvals.set(id, { to, resolve, timer: timers.setTimeout(() => settleApproval(id, false), APPROVAL_TIMEOUT_MS) });
      sendMessages(to, messages, undefined, true).then((sent) => { if (!sent) settleApproval(id, false); }, (e) => { fail(e); settleApproval(id, false); });
    });
  }

  function onTap(to: string, userId: string, data: string): void {
    const i = data.indexOf(':');
    const action = data.slice(0, i), id = data.slice(i + 1);
    if (action === 'approve' || action === 'deny') {
      // Only allow.users may approve, and only in the chat the question was asked in.
      if (opts.config.allow.users.includes(userId) && approvals.get(id)?.to === to) settleApproval(id, action === 'approve');
      return;
    }
    if (action !== 'get') return;
    const p = pendings.get(id);
    if (!p || p.to !== to) { say(to, 'That answer is no longer available.').catch(fail); return; }
    if (p.state === 'PENDING') { sendMessages(to, [workingMessage(p)], undefined, true).catch(fail); return; }
    if (p.state === 'DELIVERED') { say(to, 'That answer was already sent above.').catch(fail); return; }
    if (p.sending) return;
    p.sending = true;
    void sendMessages(to, textMessages(p.text ?? ''), p, true).then(
      (sent) => { if (sent && !closed) { p.state = 'DELIVERED'; p.text = undefined; } }, // stopped early: the next tap resumes at the remainder
      fail, // Keep the successfully delivered batches; the next tap resumes at the remainder.
    ).finally(() => { p.sending = false; });
  }

  // ---- events

  // Download, store and extract in the background (not in the chat queue: a big video must not hold up text runs).
  // The acknowledgement goes through the queue, and only while LINE is enabled.
  function takeMedia(chat: { to: string; userId: string; sourceType: SourceType }, ev: LineEvent, kind: MediaKind): void {
    const media = opts.media;
    if (!media || typeof ev.message?.id !== 'string') return;
    void ingestMedia({
      messageId: ev.message.id, kind, sourceType: chat.sourceType, sourceId: chat.to, userId: chat.userId,
      timestamp: typeof ev.timestamp === 'number' ? ev.timestamp : undefined,
      fileName: typeof ev.message.fileName === 'string' ? ev.message.fileName : undefined,
    }, { ...media, accessToken: opts.accessToken, fetchImpl, signal: closing.signal, now }).then((r) => {
      if (r.error) fail(new Error(`LINE media ${r.messageId}: ${r.error}`));
      opts.onMedia?.(r);
      if (r.error || closed || !opts.config.enabled) return;
      const what = kind === 'image' ? 'รูป' : kind === 'video' ? 'วิดีโอ' : kind === 'audio' ? 'เสียง' : 'ไฟล์';
      enqueue(chat.to, () => say(chat.to, `รับ${what}แล้ว บันทึกไว้เรียบร้อยครับ`).then(() => {}));
    }, fail);
  }

  function resolveChat(src: Source | undefined): { to: string; userId: string; allowed: boolean; sourceType: SourceType } | undefined {
    if (!src) return undefined;
    const userId = typeof src.userId === 'string' ? src.userId : '';
    const { users, groups, rooms } = opts.config.allow;
    if (src.type === 'user' && userId) return { to: userId, userId, allowed: users.includes(userId), sourceType: 'user' };
    if (src.type === 'group' && typeof src.groupId === 'string') return { to: src.groupId, userId, allowed: groups.includes(src.groupId), sourceType: 'group' };
    if (src.type === 'room' && typeof src.roomId === 'string') return { to: src.roomId, userId, allowed: rooms.includes(src.roomId), sourceType: 'room' };
    return undefined;
  }

  function handleEvent(ev: LineEvent): void {
    if (closed) return;
    if (typeof ev.webhookEventId === 'string') {
      if (seen.has(ev.webhookEventId)) return;
      seen.add(ev.webhookEventId);
      if (seen.size > MAX_SEEN) seen.delete(seen.values().next().value!);
    }
    const chat = resolveChat(ev.source);
    if (!chat?.allowed) return; // deny by default: strangers get no reply and no work
    const msgType = ev.type === 'message' ? ev.message?.type : undefined;
    const isText = msgType === 'text' && typeof ev.message?.text === 'string';
    const isMedia = msgType === 'image' || msgType === 'video' || msgType === 'audio' || msgType === 'file';
    const isTap = ev.type === 'postback' && typeof ev.postback?.data === 'string';
    if (!isText && !isMedia && !isTap) return;
    if (typeof ev.replyToken === 'string') chatOf(chat.to).token = { value: ev.replyToken, at: now() };
    if (isText) {
      const text = ev.message!.text as string;
      enqueue(chat.to, () => runMessage(chat.to, chat.userId, text));
    } else if (isMedia) {
      takeMedia(chat, ev, msgType as MediaKind);
    } else {
      onTap(chat.to, chat.userId, ev.postback!.data as string); // taps bypass the queue: a run may be waiting on this very answer
    }
  }

  // ---- HTTP

  // Resolves null when the body is over the limit. The rest of it is read and thrown away (up to a cap) so the
  // client can still receive the 413.
  function readBody(req: IncomingMessage): Promise<Buffer | null> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let total = 0, over = Number(req.headers['content-length'] ?? 0) > MAX_BODY;
      if (over) resolve(null);
      req.on('data', (c: Buffer) => {
        total += c.length;
        if (over) { if (total > 4 * MAX_BODY) req.destroy(); return; }
        if (total > MAX_BODY) { over = true; chunks.length = 0; resolve(null); return; }
        chunks.push(c);
      });
      req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
      req.on('error', reject);
    });
  }

  function validSignature(raw: Buffer, header: string | string[] | undefined): boolean {
    if (typeof header !== 'string') return false;
    const expected = Buffer.from(createHmac('sha256', opts.channelSecret).update(raw).digest('base64'));
    const got = Buffer.from(header);
    return got.length === expected.length && timingSafeEqual(got, expected);
  }

  const respond = (res: ServerResponse, status: number, headers: Record<string, string> = {}) => {
    if (!res.headersSent) res.writeHead(status, { 'Content-Length': '0', ...headers });
    res.end();
  };

  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      if ((req.url ?? '').split('?')[0] === '/line/webhook/health') {
        if (req.method !== 'GET') return respond(res, 405, { Allow: 'GET' });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"ok":true}'); return;
      }
      if ((req.url ?? '').split('?')[0] !== '/line/webhook') return respond(res, 404);
      if (req.method !== 'POST') return respond(res, 405, { Allow: 'POST' });
      const raw = await readBody(req);
      if (!raw) return respond(res, 413);
      if (!validSignature(raw, req.headers['x-line-signature'])) return respond(res, 401);
      let body: { events?: unknown };
      try { body = JSON.parse(raw.toString('utf8')); } catch { return respond(res, 400); }
      respond(res, 200); // acknowledge first; the work happens after
      lastEventAt = now();
      for (const ev of Array.isArray(body?.events) ? body.events : []) {
        try { handleEvent(ev as LineEvent); } catch (e) { fail(e); }
      }
    } catch (e) {
      fail(e);
      respond(res, 500);
    }
  }

  async function bind(port: number): Promise<Server> {
    const s = createServer((req, res) => { void handler(req, res); });
    s.requestTimeout = 30_000;
    await new Promise<void>((resolve, reject) => {
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => { s.off('error', reject); resolve(); });
    });
    s.on('error', fail);
    return s;
  }
  const shut = (s: Server) => new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); });

  return {
    handler,

    /** Listens on 127.0.0.1; resolves with the bound port (0 = ephemeral). */
    async listen(port: number): Promise<number> {
      if (closed) throw new Error('LINE gateway is closed');
      if (server) throw new Error('LINE gateway is already listening');
      const s = await bind(port);
      server = s; listenPort = port;
      return (s.address() as AddressInfo).port;
    },

    /**
     * Applies new settings and credentials to the running gateway and moves the listener when the port changed.
     * Queued messages, runs in flight, open approvals and parked "Get answer" answers stay, and finish through the new
     * credentials. A failed bind throws and leaves the old listener up.
     */
    async reconfigure(next: Pick<LineGatewayOptions, 'config' | 'channelSecret' | 'accessToken'>, port: number): Promise<void> {
      if (closed) throw new Error('LINE gateway is closed');
      Object.assign(opts, next);
      if (!server || port === listenPort) return;
      const s = await bind(port), old = server;
      server = s; listenPort = port;
      await shut(old);
    },

    /** Stops new work and sends, drops queued runs, stops timers and denies open approvals. */
    async close(): Promise<void> {
      closed = true; closing.abort();
      for (const chat of chats.values()) { chat.queue.length = 0; chat.token = undefined; }
      for (const id of [...approvals.keys()]) settleApproval(id, false);
      for (const t of slowTimers) timers.clearTimeout(t);
      slowTimers.clear();
      const s = server;
      server = undefined;
      if (s) await shut(s);
    },

    /** Sends text to a chat: free reply token when it is young, otherwise (or when LINE refuses it) a push. */
    push: send,

    /** Confirm buttons; true only for Allow from an allow.users member in that chat. Denies after 10 minutes. */
    askApproval,

    status(): LineStatus {
      const addr = server?.address();
      return {
        running: !!server?.listening, port: addr && typeof addr === 'object' ? addr.port : undefined, lastEventAt, lastError,
        pending: [...pendings.values()].map((p) => ({ id: p.id, to: p.to, state: p.state })),
      };
    },
  };
}

export type LineGateway = ReturnType<typeof createLineGateway>;
