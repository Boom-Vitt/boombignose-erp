import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { VERSION, paths, maskSecret, setSecret, getApiKey } from '../config.ts';
import { deleteSkill, listSkills, loadSkill, saveSkill } from '../skills/index.ts';
import { CommandError, listCommands } from '../commands/index.ts';
import { doctor } from '../app/doctor.ts';
import { isObject, restoreMaskedConfig, safeValue, settingsResponse, validateAgent, validateConfig, validateMcpName, validateMcpServer } from '../app/settings.ts';
import type { AgentInput } from '../store/index.ts';
import type { Runtime } from '../app/runtime.ts';
import type { Config, Delivery } from '../types.ts';
import type { Scheduler } from '../cron/index.ts';
import type { McpManager } from '../mcp/manager.ts';
import { lineBotInfo, setLineWebhook, testLineWebhook, publicUrlProblem, webhookUrlFor } from '../line/index.ts';
import { listModels } from '../providers/models.ts';
import { isOllama, OLLAMA_CONTEXT_NOTE, ollamaWarnings } from '../providers/ollama.ts';
import type { LineApiOptions } from '../line/index.ts';

export interface ApiOptions {
  fetchImpl?: typeof fetch;
  home: string; token: string; runtime: Runtime; mcp: McpManager; scheduler: Scheduler;
  config: () => Config; updateSettings: (config: Config | ((current: Config) => Config)) => Promise<void>; reloadSecrets: () => Promise<void>;
  lineStatus: () => { enabled: boolean; running: boolean; port: number; agentId: string; publicUrl?: string; webhookUrl?: string; healthUrl?: string; warnings: string[]; tokenSet: boolean; secretSet: boolean; lastEventAt?: number; lastError?: string };
  lineApiOptions: () => LineApiOptions;
}
class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}
const missing = () => { throw new HttpError(404, 'not found'); };
const check = (ok: unknown, message: string) => { if (!ok) throw new HttpError(400, message); };
function validate<T>(fn: () => T): T { try { return fn(); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : String(e)); } }
const origins = new Set(['tauri://localhost', 'http://tauri.localhost', 'https://tauri.localhost']);

async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0, over = Number(req.headers['content-length']) > 1024 * 1024;
    if (over) reject(new HttpError(413, 'body exceeds 1 MiB'));
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (over) { if (size > 4 * 1024 * 1024) req.destroy(); return; }
      if (size > 1024 * 1024) { over = true; chunks.length = 0; reject(new HttpError(413, 'body exceeds 1 MiB')); return; }
      chunks.push(chunk);
    });
    req.on('end', () => { if (!over) resolve(Buffer.concat(chunks)); });
    req.on('error', reject);
  });
  let value: unknown;
  try { value = JSON.parse(raw.toString('utf8') || '{}'); } catch { throw new HttpError(400, 'invalid JSON'); }
  check(isObject(value), 'body must be an object');
  return value as Record<string, unknown>;
}
function text(v: unknown, name: string): string { check(typeof v === 'string' && !!v.trim(), `${name} is required`); return v as string; }
function delivery(v: unknown): Delivery {
  check(isObject(v) && (v.kind === 'desktop' || (v.kind === 'line' && typeof v.to === 'string' && !!v.to.trim())), 'invalid delivery');
  return v as Delivery;
}
const positiveId = (s: string) => { check(/^\d+$/.test(s) && Number.isSafeInteger(Number(s)) && Number(s) > 0, 'invalid id'); return Number(s); };

export function createApiServer(opts: ApiOptions) {
  const { runtime, mcp, scheduler } = opts, store = runtime.store;
  let port = 0;
  const streams = new Set<ServerResponse>();
  const send = (res: ServerResponse, value: unknown, status = 200) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(safeValue(value, runtime.cleaner())));
  };
  const agentId = (value: unknown, optional = false): string => {
    if (value === undefined && optional) return store.listAgents()[0]!.id;
    check(typeof value === 'string' && !!store.getAgent(value), 'unknown agent');
    return value as string;
  };
  async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const origin = req.headers.origin;
      if (origin && origins.has(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin');
      }
      if (req.headers.host !== `127.0.0.1:${port}` && req.headers.host !== `localhost:${port}`) throw new HttpError(403, 'foreign Host');
      if (req.method === 'OPTIONS') {
        if (origin && origins.has(origin)) {
          res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
          res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
          res.setHeader('Access-Control-Max-Age', '600');
        }
        res.writeHead(204); res.end(); return;
      }
      const expected = Buffer.from(`Bearer ${opts.token}`), got = Buffer.from(req.headers.authorization ?? '');
      if (got.length !== expected.length || !timingSafeEqual(got, expected)) throw new HttpError(401, 'unauthorized');
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const segments = validate(() => url.pathname.split('/').slice(1).map(decodeURIComponent));
      const [root, area, id, action] = segments, method = req.method;
      if (root !== 'api' || segments.length > 4) return missing();
      if (area === 'events' && !id && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        res.flushHeaders();
        const write = (event: unknown) => { if (!res.destroyed) res.write(`data: ${JSON.stringify(event)}\n\n`); };
        const unsubscribe = runtime.subscribe(write);
        for (const event of runtime.replay()) write(event);
        streams.add(res);
        const timer = setInterval(() => res.write(': ping\n\n'), 15_000); timer.unref();
        res.on('close', () => { clearInterval(timer); unsubscribe(); streams.delete(res); });
        return;
      }
      if (area === 'health' && !id && method === 'GET') return send(res, { ok: true, version: VERSION, pid: process.pid });
      if (area === 'doctor' && !id && method === 'POST') {
        await body(req);
        return send(res, await doctor(opts.home, opts.fetchImpl));
      }
      if (area === 'status' && !id && method === 'GET') {
        const c = opts.config(), p = c.providers.find(p => p.id === c.active.provider)!, l = opts.lineStatus();
        return send(res, { version: VERSION, provider: { id: p.id, kind: p.kind, model: c.active.model },
          line: { enabled: l.enabled, running: l.running, webhookUrl: l.webhookUrl },
          mcp: mcp.status().map(s => ({ name: s.name, enabled: s.enabled, connected: s.connected, tools: s.tools.length })), schedules: scheduler.list().length });
      }
      if (area === 'providers' && id && method === 'GET') {
        const config = opts.config(), provider = config.providers.find(p => p.id === id);
        if (!provider) return missing();
        const key = getApiKey(config, id, opts.home);
        if (action === 'models') {
          try { return send(res, { ok: true, models: await listModels(provider, key, opts.fetchImpl) }); }
          catch (e) { return send(res, { ok: false, error: e instanceof Error ? e.message : String(e), models: [] }); }
        }
        if (action === 'status') return send(res, isOllama(provider)
          ? { note: OLLAMA_CONTEXT_NOTE, warnings: await ollamaWarnings(provider, key, opts.fetchImpl) } : { warnings: [] });
      }
      if (area === 'agents' && !action) {
        if (!id && method === 'GET') return send(res, { agents: store.listAgents() });
        if (!id && method === 'POST') {
          const b = await body(req), c = opts.config(); validate(() => validateAgent(b, c));
          return send(res, store.createAgent({ ...c.active, ...b } as AgentInput), 201);
        }
        if (!id || !store.getAgent(id)) return missing();
        if (method === 'GET') return send(res, store.getAgent(id));
        if (method === 'PATCH') {
          const b = await body(req); validate(() => validateAgent(b, opts.config(), true));
          const agent = store.updateAgent(id, b); if (!agent) return missing();
          return send(res, agent);
        }
        if (method === 'DELETE') {
          if (store.listAgents().length === 1) throw new HttpError(409, 'cannot delete the last agent');
          try { if (!await runtime.deleteAgent(id)) return missing(); }
          catch (e) { if (e instanceof Error && e.message === 'cannot delete the last agent') throw new HttpError(409, e.message); throw e; }
          await opts.updateSettings(c => {
            if (c.line.agentId === id) delete c.line.agentId;
            return c;
          });
          return send(res, { ok: true });
        }
      }
      if (area === 'sessions') {
        if (!id && method === 'GET') {
          const limit = Number(url.searchParams.get('limit') ?? 100);
          check(Number.isSafeInteger(limit) && limit > 0 && limit <= 1000, 'limit must be 1-1000');
          const q = url.searchParams.get('q'), agent = url.searchParams.get('agent') ?? undefined;
          const sessions = q ? store.searchMessages(q, limit, agent).map(h => ({ id: h.sessionId, agentId: store.getSession(h.sessionId)!.agentId, title: h.title, updatedAt: store.getSession(h.sessionId)!.updatedAt, snippet: h.snippet }))
            : store.listSessions({ limit, agentId: agent }).map(s => ({ id: s.id, agentId: s.agentId, title: s.title, updatedAt: s.updatedAt }));
          return send(res, { sessions });
        }
        if (!id && method === 'POST') {
          const b = await body(req); check(b.title === undefined || typeof b.title === 'string', 'invalid title');
          return send(res, { id: store.createSession({ title: b.title as string | undefined, origin: { kind: 'desktop' }, agentId: agentId(b.agentId, true) }).id });
        }
        const s = id && store.getSession(id); if (!s) return missing();
        if (!action && method === 'GET') return send(res, { id: s.id, agentId: s.agentId, title: s.title, messages: store.getMessages(s.id), notices: store.getNotices(s.id), live: runtime.liveTurn(s.id) ?? null });
        if (!action && method === 'DELETE') {
          if (runtime.isRunning(s.id)) throw new HttpError(409, 'session is running');
          store.deleteSession(s.id); runtime.emit({ type: 'session_updated', sessionId: s.id }); return send(res, { ok: true });
        }
        if (action === 'messages' && method === 'POST') {
          const b = await body(req), input = text(b.text, 'text');
          if (runtime.isRunning(s.id)) throw new HttpError(409, 'session is already running');
          const run = runtime.start(s.id, input, { origin: { kind: 'desktop' } });
          void run.result.catch(e => runtime.emit({ type: 'run_end', sessionId: s.id, runId: run.runId, status: 'error', text: '', error: runtime.clean(String(e)) }));
          return send(res, { runId: run.runId }, 202);
        }
        if (action === 'interrupt' && method === 'POST') return send(res, { ok: runtime.interrupt(s.id) });
      }
      if (area === 'approvals' && id && !action && method === 'POST') {
        const b = await body(req); check(typeof b.allow === 'boolean', 'allow must be boolean');
        if (!runtime.decideApproval(id, b.allow as boolean)) return missing();
        return send(res, { ok: true });
      }
      if (area === 'settings' && !id) {
        if (method === 'PUT') {
          const b = await body(req);
          await opts.updateSettings(c => validate(() => {
            const next = restoreMaskedConfig(b.config as Config, c, runtime.cleaner());
            if (typeof next.line?.publicUrl === 'string') next.line.publicUrl = next.line.publicUrl.trim();
            validateConfig(next);
            if (next.line.publicUrl && next.line.publicUrl !== c.line.publicUrl?.trim()) check(!publicUrlProblem(next.line.publicUrl), publicUrlProblem(next.line.publicUrl) ?? '');
            if (next.line.agentId !== undefined) agentId(next.line.agentId);
            return next;
          }));
        } else if (method !== 'GET') return missing();
        return send(res, settingsResponse(opts.config(), opts.home));
      }
      if (area === 'secrets' && !id && method === 'PUT') {
        const b = await body(req); check(typeof b.name === 'string' && typeof b.value === 'string', 'name and value must be strings');
        validate(() => setSecret(b.name as string, b.value ? b.value as string : null, opts.home));
        await opts.reloadSecrets(); return send(res, { name: b.name, masked: maskSecret(b.value as string) });
      }
      if (area === 'mcp') {
        if (!id && method === 'GET') return send(res, { servers: mcp.status() });
        if (!id && method === 'POST') {
          const b = await body(req); validate(() => { validateMcpName(b.name); validateMcpServer(b.config); });
          await opts.updateSettings(c => {
            const name = b.name as string;
            check(!Object.hasOwn(c.mcp.servers, name), 'MCP server already exists');
            c.mcp.servers[name] = b.config as Config['mcp']['servers'][string]; return c;
          });
          return send(res, { ok: true });
        }
        if (id && !action && method === 'PATCH') {
          const b = await body(req); check(b.enabled !== undefined || b.tools !== undefined, 'enabled or tools is required');
          await opts.updateSettings(c => {
            if (!Object.hasOwn(c.mcp.servers, id)) return missing();
            c.mcp.servers[id] = { ...c.mcp.servers[id]!, ...(b.enabled !== undefined ? { enabled: b.enabled as boolean } : {}), ...(b.tools !== undefined ? { tools: b.tools as string[] } : {}) };
            validate(() => validateMcpServer(c.mcp.servers[id])); return c;
          });
          return send(res, { ok: true });
        }
        if (id && !action && method === 'DELETE') {
          await opts.updateSettings(c => {
            if (!Object.hasOwn(c.mcp.servers, id)) return missing();
            check(id !== 'rea', 'rea is built in: disable it instead');
            delete c.mcp.servers[id]; return c;
          });
          return send(res, { ok: true });
        }
        const servers = opts.config().mcp.servers;
        const server = id && Object.hasOwn(servers, id) ? servers[id] : undefined; if (!server || !id) return missing();
        if (action === 'test' && method === 'POST') return send(res, await mcp.test(id));
        if (action === 'tools' && method === 'GET') return send(res, { tools: mcp.listTools(id).map(t => ({ name: t.name, description: t.description, selected: !server.tools || server.tools.includes(t.name) })) });
      }
      const dir = paths(opts.home).skills;
      if (area === 'commands' && !id && method === 'GET') {
        const agent = store.getAgent(agentId(url.searchParams.get('agent') ?? undefined, true))!;
        return send(res, { commands: listCommands(listSkills(dir).filter(s => agent.skills === null || agent.skills.includes(s.name))) });
      }
      if (area === 'skills' && !action) {
        if (!id && method === 'GET') return send(res, { skills: listSkills(dir) });
        if (id && method === 'GET') {
          const skill = validate(() => loadSkill(dir, id)); if (!skill) return missing();
          return send(res, { name: skill.name, description: skill.description, body: skill.body });
        }
        if (id && method === 'PUT') {
          const b = await body(req); check(typeof b.description === 'string' && typeof b.body === 'string', 'description and body must be strings');
          validate(() => saveSkill(dir, { name: id, description: b.description as string, body: b.body as string })); return send(res, { ok: true });
        }
        if (id && method === 'DELETE') { if (!validate(() => deleteSkill(dir, id))) return missing(); return send(res, { ok: true }); }
      }
      if (area === 'memory' && !action) {
        const noteShape = (n: { id: number; agentId: string | null; kind: string; text: string; updatedAt: number }) => ({ id: n.id, agentId: n.agentId, kind: n.kind, text: n.text, updatedAt: n.updatedAt });
        if (!id && method === 'GET') {
          const kind = url.searchParams.get('kind') || undefined, q = url.searchParams.get('q'), agent = url.searchParams.get('agent') ?? undefined;
          check(kind === undefined || kind === 'user' || kind === 'agent', 'invalid kind');
          return send(res, { notes: (q ? store.searchMemory(q, 100, kind as 'user' | 'agent' | undefined, agent) : store.listMemory(kind as 'user' | 'agent' | undefined, agent)).map(noteShape) });
        }
        if (!id && method === 'POST') {
          const b = await body(req); check(b.kind === 'user' || b.kind === 'agent', 'invalid kind');
          const owner = b.kind === 'agent' ? agentId(b.agentId) : undefined;
          return send(res, noteShape(store.addMemory(b.kind as 'user' | 'agent', text(b.text, 'text'), owner)));
        }
        if (id && method === 'PUT') {
          const b = await body(req), n = store.updateMemory(positiveId(id), text(b.text, 'text')); if (!n) return missing(); return send(res, noteShape(n));
        }
        if (id && method === 'DELETE') { if (!store.deleteMemory(positiveId(id))) return missing(); return send(res, { ok: true }); }
      }
      if (area === 'schedules' && !action) {
        if (!id && method === 'GET') {
          const agent = url.searchParams.get('agent');
          return send(res, { jobs: scheduler.list().filter(j => agent === null || j.agentId === agent).map(j => ({ ...j, nextRunAt: j.nextRunAt ?? null })) });
        }
        if (!id && method === 'POST') {
          const b = await body(req), cron = text(b.cron, 'cron'), prompt = text(b.prompt, 'prompt'), to = delivery(b.delivery);
          return send(res, validate(() => scheduler.add({ cron, prompt, delivery: to, agentId: agentId(b.agentId, true) })));
        }
        if (id && method === 'PATCH') {
          const b = await body(req); check(typeof b.enabled === 'boolean', 'enabled must be boolean');
          if (!scheduler.setEnabled(id, b.enabled as boolean)) return missing(); return send(res, { ok: true });
        }
        if (id && method === 'DELETE') { if (!scheduler.remove(id)) return missing(); return send(res, { ok: true }); }
      }
      if (area === 'line' && !action) {
        if (id === 'status' && method === 'GET') return send(res, opts.lineStatus());
        if ((id === 'connect' || id === 'test') && method === 'POST') {
          const o = opts.lineApiOptions(), publicUrl = opts.config().line.publicUrl?.trim();
          const problem = !publicUrl ? 'Set a public HTTPS URL first.' : publicUrlProblem(publicUrl);
          const webhookUrl = publicUrl && !problem ? webhookUrlFor(publicUrl) : undefined;
          const clean = runtime.cleaner();
          if (id === 'connect') {
            let bot: { displayName: string; basicId: string } | undefined;
            let tokenDetail = 'Save the channel access token first.';
            if (o.accessToken) {
              try {
                const info = await lineBotInfo(o); bot = { displayName: info.displayName, basicId: info.basicId };
                tokenDetail = `Connected to ${bot.displayName} (${bot.basicId})`;
              } catch (e) { tokenDetail = clean(e instanceof Error ? e.message : String(e)); }
            }
            let webhookOk = false, webhookDetail = !bot ? 'Fix the token first.' : problem ?? '';
            if (bot && webhookUrl) {
              try { await setLineWebhook(o, webhookUrl); webhookOk = true; webhookDetail = `Webhook set to ${webhookUrl}`; }
              catch (e) { webhookDetail = clean(e instanceof Error ? e.message : String(e)); }
            }
            return send(res, safeValue({ ok: !!bot && webhookOk, ...(bot ? { bot } : {}), ...(webhookUrl ? { webhookUrl } : {}),
              steps: [{ name: 'token', ok: !!bot, detail: tokenDetail }, { name: 'webhook', ok: webhookOk, detail: webhookDetail }] }, clean));
          }
          const running = opts.lineStatus().running;
          const detail = !o.accessToken ? 'Save the channel access token first.' : problem ?? (!running
            ? 'The LINE listener is not running. Turn LINE on, save, then test again.' : undefined);
          if (detail) return send(res, { ok: false, running, detail });
          try {
            const result = await testLineWebhook(o, webhookUrl!);
            return send(res, safeValue({ ok: result.success, running, statusCode: result.statusCode, reason: result.reason, detail: result.detail || result.reason || '' }, clean));
          } catch (e) { return send(res, { ok: false, running, detail: clean(e instanceof Error ? e.message : String(e)) }); }
        }
      }
      return missing();
    } catch (e) {
      if (res.headersSent) { res.end(); return; }
      send(res, { error: e instanceof Error ? e.message : String(e), ...(e instanceof CommandError && e.connector ? { connector: e.connector } : {}) },
        e instanceof HttpError || e instanceof CommandError ? e.status : 500);
    }
  }
  const server = createServer((req, res) => { void handler(req, res); });
  server.requestTimeout = 30_000;
  return {
    async listen(requestedPort: number): Promise<number> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject);
        server.listen(requestedPort, '127.0.0.1', () => { server.off('error', reject); resolve(); });
      });
      port = (server.address() as AddressInfo).port; return port;
    },
    async close(): Promise<void> {
      for (const res of streams) res.end();
      await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
    },
  };
}
