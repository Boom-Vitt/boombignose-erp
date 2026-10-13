// LINE Messaging API webhook gateway (design.md section 7). Own 127.0.0.1 server, signature check, allowlists,
// reply-token-first sending with push fallback, slow-response "Get answer" button, confirm-button approvals.
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, Server, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { LineConfig } from '../types.ts';

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
  onMessage: (m: { to: string; userId: string; text: string }) => Promise<string>;
  fetchImpl?: typeof fetch;
  apiBase?: string;
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
  type?: string; webhookEventId?: unknown; replyToken?: unknown; source?: Source;
  message?: { type?: string; text?: unknown }; postback?: { data?: unknown };
}
interface Chat { token?: { value: string; at: number }; queue: (() => Promise<void>)[]; busy: boolean }
interface Pending { id: string; to: string; state: PendingState; text?: string }

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

export function createLineGateway(opts: LineGatewayOptions) {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const apiBase = (opts.apiBase ?? 'https://api.line.me').replace(/\/+$/, '');
  const now = opts.now ?? Date.now;
  const timers = opts.timers ?? { setTimeout, clearTimeout };

  const seen = new Set<string>();
  const chats = new Map<string, Chat>();
  const pendings = new Map<string, Pending>();
  const approvals = new Map<string, { to: string; resolve: (ok: boolean) => void; timer: unknown }>();
  const slowTimers = new Set<unknown>();
  let closed = false;
  let server: Server | undefined;
  let lastEventAt: number | undefined;
  let lastError: string | undefined;

  const chatOf = (to: string): Chat => {
    let c = chats.get(to);
    if (!c) chats.set(to, (c = { queue: [], busy: false }));
    return c;
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
    const res = await fetchImpl(`${apiBase}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${opts.accessToken}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    let text = await res.text().catch(() => '');
    if (!res.ok) {
      for (const secret of [opts.accessToken, opts.channelSecret]) if (secret) text = text.replaceAll(secret, '***');
      throw new Error(`LINE ${path} failed: ${res.status} ${text.slice(0, 200)}`);
    }
  }

  /** The chat's latest reply token if it is still young; tokens are single use, so it is dropped either way. */
  function takeToken(to: string): string | undefined {
    const chat = chatOf(to), t = chat.token;
    chat.token = undefined;
    return t && now() - t.at < TOKEN_TTL_MS ? t.value : undefined;
  }

  // At most 5 messages per call. The first call tries the free reply token; if there is none, or LINE refuses it
  // (expired, already used), it goes out as a metered push. Further calls are always pushes.
  async function sendMessages(to: string, messages: LineMessage[]): Promise<void> {
    for (let i = 0; i < messages.length; i += MAX_PER_CALL) {
      if (closed) return;
      const batch = messages.slice(i, i + MAX_PER_CALL);
      const token = i === 0 ? takeToken(to) : undefined;
      if (token) {
        try { await call('/v2/bot/message/reply', { replyToken: token, messages: batch }); continue; } catch (e) { fail(e); }
      }
      await call('/v2/bot/message/push', { to, messages: batch });
    }
  }
  const send = (to: string, text: string) => sendMessages(to, textMessages(text));

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
    if (closed) return;
    const answer = Promise.resolve()
      .then(() => closed ? '' : opts.onMessage({ to, userId, text }))
      .catch((e) => { fail(e); return 'Sorry, something went wrong.'; });
    let timer: unknown;
    const slow = new Promise<null>((resolve) => {
      const ms = opts.config.slowResponseMs; // setTimeout fires at once for NaN or > 2^31-1
      timer = timers.setTimeout(() => resolve(null), ms > 0 ? Math.min(ms, MAX_TIMER) : 45_000);
      slowTimers.add(timer);
    });
    const early = await Promise.race([answer, slow]);
    slowTimers.delete(timer);
    if (closed) return;
    if (early !== null) {
      timers.clearTimeout(timer);
      await send(to, early);
      return;
    }
    // Too slow for the reply token: park the answer behind a "Get answer" button.
    const pending: Pending = { id: randomBytes(6).toString('hex'), to, state: 'PENDING' };
    remember(pending);
    try { await sendMessages(to, [workingMessage(pending)]); } catch (e) {
      fail(e);
      pendings.delete(pending.id);
      await send(to, await answer);
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
    if (closed) return Promise.resolve(false);
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
      sendMessages(to, messages).catch((e) => { fail(e); settleApproval(id, false); });
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
    if (!p || p.to !== to) { send(to, 'That answer is no longer available.').catch(fail); return; }
    if (p.state === 'PENDING') { sendMessages(to, [workingMessage(p)]).catch(fail); return; }
    if (p.state === 'DELIVERED') { send(to, 'That answer was already sent above.').catch(fail); return; }
    p.state = 'DELIVERED';
    send(to, p.text ?? '').then(
      () => { p.text = undefined; },
      (e) => { p.state = 'READY'; fail(e); }, // not delivered: let the next tap retry
    );
  }

  // ---- events

  function resolveChat(src: Source | undefined): { to: string; userId: string; allowed: boolean } | undefined {
    if (!src) return undefined;
    const userId = typeof src.userId === 'string' ? src.userId : '';
    const { users, groups, rooms } = opts.config.allow;
    if (src.type === 'user' && userId) return { to: userId, userId, allowed: users.includes(userId) };
    if (src.type === 'group' && typeof src.groupId === 'string') return { to: src.groupId, userId, allowed: groups.includes(src.groupId) };
    if (src.type === 'room' && typeof src.roomId === 'string') return { to: src.roomId, userId, allowed: rooms.includes(src.roomId) };
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
    const isText = ev.type === 'message' && ev.message?.type === 'text' && typeof ev.message.text === 'string';
    const isTap = ev.type === 'postback' && typeof ev.postback?.data === 'string';
    if (!isText && !isTap) return;
    if (typeof ev.replyToken === 'string') chatOf(chat.to).token = { value: ev.replyToken, at: now() };
    if (isText) {
      const text = ev.message!.text as string;
      enqueue(chat.to, () => runMessage(chat.to, chat.userId, text));
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

  return {
    handler,

    /** Listens on 127.0.0.1; resolves with the bound port (0 = ephemeral). */
    async listen(port: number): Promise<number> {
      if (closed) throw new Error('LINE gateway is closed');
      if (server) throw new Error('LINE gateway is already listening');
      const s = createServer((req, res) => { void handler(req, res); });
      s.requestTimeout = 30_000;
      await new Promise<void>((resolve, reject) => {
        s.once('error', reject);
        s.listen(port, '127.0.0.1', () => { s.off('error', reject); resolve(); });
      });
      s.on('error', fail);
      server = s;
      return (s.address() as AddressInfo).port;
    },

    /** Stops new work and sends, drops queued runs, stops timers and denies open approvals. */
    async close(): Promise<void> {
      closed = true;
      for (const chat of chats.values()) { chat.queue.length = 0; chat.token = undefined; }
      for (const id of [...approvals.keys()]) settleApproval(id, false);
      for (const t of slowTimers) timers.clearTimeout(t);
      slowTimers.clear();
      const s = server;
      server = undefined;
      if (!s) return;
      await new Promise<void>((resolve) => { s.close(() => resolve()); s.closeAllConnections(); });
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
