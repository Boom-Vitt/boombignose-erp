import { randomUUID } from 'node:crypto';
import { runAgent } from '../agent/loop.ts';
import type { RunResult } from '../agent/loop.ts';
import { withAbort } from '../agent/abort.ts';
import { effectivePolicy } from '../agent/permissions.ts';
import { paths, readEnv } from '../config.ts';
import { createProvider } from '../providers/index.ts';
import { builtinTools } from '../tools/index.ts';
import { memoryPrompt, memoryTools, sessionSearchTool } from '../memory/tools.ts';
import { skillsIndex, skillTools } from '../skills/index.ts';
import { scheduleTools } from '../cron/index.ts';
import type { Scheduler } from '../cron/index.ts';
import type { Store, Job } from '../store/index.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { LineGateway } from '../line/index.ts';
import type { AgentEvent, ApprovalRequest, Approver, Config, HooksConfig, Origin, Policy, ProviderConfig, Tool } from '../types.ts';
import { safeText, safeValue } from './settings.ts';

export type ApiEvent = (AgentEvent & { sessionId: string; runId: string })
  | { type: 'run_start'; sessionId: string; runId: string }
  | { type: 'session_updated'; sessionId: string }
  | { type: 'notification'; title: string; body: string; sessionId?: string };
export interface RunProfile {
  provider: ProviderConfig; model: string; system: string; permissions: Record<string, Policy>;
  hooks: HooksConfig; cwd: string; maxTurns: number; maxTokens: number; contextWindow: number; compactAt: number;
  toolFilter?: (tool: Tool) => boolean;
}
export interface RuntimeOptions {
  home: string; token?: string; store: Store; mcp: McpManager; scheduler: Scheduler;
  config: () => Config; line: () => LineGateway | undefined;
  providerFactory?: typeof createProvider;
}
interface ActiveRun { runId: string; controller: AbortController; result: Promise<RunResult> }
interface PendingApproval { event: ApiEvent; decide: (ok: boolean) => void }

export class Runtime {
  readonly store: Store;
  private opts: RuntimeOptions;
  private runs = new Map<string, ActiveRun>();
  private approvals = new Map<string, PendingApproval>();
  private listeners = new Set<(event: ApiEvent) => void>();
  private closed = false;
  constructor(opts: RuntimeOptions) { this.opts = opts; this.store = opts.store; }
  clean = (text: string) => safeText(text, this.opts.home, this.opts.config(), this.opts.token);
  emit(event: ApiEvent): void {
    const safe = safeValue(event, this.clean);
    for (const listener of this.listeners) listener(safe);
  }
  subscribe(listener: (event: ApiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  replay(): ApiEvent[] {
    return [...[...this.runs].map(([sessionId, run]) => ({ type: 'run_start' as const, sessionId, runId: run.runId })), ...this.pendingEvents()];
  }
  pendingEvents(): ApiEvent[] { return [...this.approvals.values()].map(a => safeValue(a.event, this.clean)); }
  isRunning(sessionId: string): boolean { return this.runs.has(sessionId); }
  interrupt(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    run?.controller.abort(); return !!run;
  }
  decideApproval(id: string, allow: boolean): boolean {
    const pending = this.approvals.get(id);
    if (!pending) return false;
    pending.decide(allow); return true;
  }
  profile(config = this.opts.config(), includeMemory = true): RunProfile {
    const c = structuredClone(config);
    const provider = c.providers.find(p => p.id === c.active.provider);
    if (!provider) throw new Error('active provider is missing');
    return {
      provider, model: c.active.model,
      system: [c.agent.systemPrompt || 'You are BigNose, a helpful personal assistant. Use tools carefully and ask when permission is needed.',
        includeMemory ? memoryPrompt(this.store) : '', skillsIndex(paths(this.opts.home).skills), `Today: ${new Date().toLocaleDateString('sv-SE')}`].filter(Boolean).join('\n\n'),
      permissions: c.permissions, hooks: c.hooks, cwd: c.agent.workspace, maxTurns: c.agent.maxTurns,
      maxTokens: provider.maxTokens ?? 8192, contextWindow: provider.contextWindow ?? 128000, compactAt: c.agent.compactAt,
    };
  }
  private async approve(req: ApprovalRequest, runId: string, signal: AbortSignal, cliApprove?: Approver): Promise<boolean> {
    const origin = req.origin;
    const delivery = origin.kind === 'cron' ? this.store.listJobs().find(j => j.id === origin.jobId)?.delivery : undefined;
    if (origin.kind === 'line' || delivery?.kind === 'line') {
      const to = origin.kind === 'line' ? origin.to : delivery!.kind === 'line' ? delivery!.to : '';
      const gateway = this.opts.line();
      if (!gateway) return false;
      return withAbort(gateway.askApproval(to, `${req.tool}\n${this.clean(JSON.stringify(req.input))}`), signal).catch(() => false);
    }
    if (origin.kind === 'cli') {
      if (!cliApprove) return false;
      return withAbort(cliApprove(req), AbortSignal.any([signal, AbortSignal.timeout(600_000)])).catch(() => false);
    }
    const event: ApiEvent = { type: 'approval_request', approvalId: req.id, sessionId: req.sessionId, runId, tool: req.tool, input: req.input };
    const allowed = await new Promise<boolean>(resolve => {
      const decide = (ok: boolean) => {
        if (!this.approvals.delete(req.id)) return;
        clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(ok);
      };
      const abort = () => decide(false);
      const timer = setTimeout(abort, 600_000); timer.unref();
      this.approvals.set(req.id, { event, decide });
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort(); else this.emit(event);
    });
    this.emit({ type: 'approval_result', approvalId: req.id, allowed, sessionId: req.sessionId, runId });
    return allowed;
  }
  start(sessionId: string, input: string, options: { origin?: Origin; userId?: string; profile?: RunProfile; approve?: Approver } = {}) {
    if (this.closed) throw new Error('runtime is closed');
    const session = this.store.getSession(sessionId);
    if (!session) throw new Error('session not found');
    if (this.runs.has(sessionId)) throw new Error('session is already running');
    const config = this.opts.config(), origin = options.origin ?? session.origin;
    const nonOwner = origin.kind === 'line' && !config.line.allow.users.includes(options.userId ?? '');
    const profile = options.profile ? { ...options.profile, provider: structuredClone(options.profile.provider),
      permissions: { ...options.profile.permissions }, hooks: structuredClone(options.profile.hooks) } : this.profile(config, !nonOwner);
    const allTools = [...builtinTools(this.opts.home), ...memoryTools(this.store), sessionSearchTool(this.store),
      ...skillTools(paths(this.opts.home).skills), ...scheduleTools(this.opts.scheduler), ...this.opts.mcp.tools()];
    const tools = profile.toolFilter ? allTools.filter(profile.toolFilter) : allTools;
    const permissions = { ...profile.permissions };
    if (nonOwner) for (const tool of tools) if (effectivePolicy(tool, permissions) === 'allow') permissions[tool.name] = 'ask';
    const env = readEnv(this.opts.home);
    const provider = (this.opts.providerFactory ?? createProvider)(profile.provider, profile.provider.apiKeyEnv ? env[profile.provider.apiKeyEnv] || undefined : undefined);
    const controller = new AbortController(), runId = randomUUID();
    // Start after the run is registered, so even an immediate provider completion cannot race the API.
    const result = Promise.resolve().then(async () => {
      const raw = await runAgent({ ...profile, provider, tools, permissions, sessionId, origin, signal: controller.signal,
        context: session.context, input, approve: req => this.approve(req, runId, controller.signal, options.approve),
        onEvent: e => { if (!['approval_request', 'approval_result', 'run_end'].includes(e.type)) this.emit({ ...e, sessionId, runId }); },
      });
      const completed = safeValue(raw, this.clean);
      this.store.appendMessages(sessionId, completed.added);
      this.store.setContext(sessionId, completed.context);
      if (!session.title) this.store.setTitle(sessionId, this.clean(input.replace(/\s+/g, ' ').slice(0, 80)));
      this.runs.delete(sessionId);
      this.emit({ type: 'session_updated', sessionId });
      this.emit({ type: 'run_end', status: completed.status, text: completed.text, ...(completed.error ? { error: completed.error } : {}), sessionId, runId });
      return completed;
    }).finally(() => { this.runs.delete(sessionId); });
    this.runs.set(sessionId, { runId, controller, result });
    this.emit({ type: 'run_start', sessionId, runId });
    return { runId, result };
  }
  async lineMessage(message: { to: string; userId: string; text: string }): Promise<string> {
    const origin: Origin = { kind: 'line', to: message.to };
    const session = this.store.findSessionByOrigin(origin) ?? this.store.createSession({ origin });
    const result = await this.start(session.id, message.text, { origin, userId: message.userId }).result;
    return result.status === 'error' ? `Error: ${result.error}` : result.text || `Run ${result.status}.`;
  }
  async fireJob(job: Job): Promise<void> {
    try {
      const origin: Origin = { kind: 'cron', jobId: job.id };
      const session = this.store.createSession({ origin, title: `Scheduled: ${job.prompt.slice(0, 60)}` });
      const result = await this.start(session.id, job.prompt, { origin }).result;
      if (result.status !== 'done') throw new Error(result.error ?? `Run ${result.status}`);
      if (job.delivery.kind === 'line') {
        const gateway = this.opts.line();
        if (!gateway) throw new Error('LINE gateway is unavailable');
        await gateway.push(job.delivery.to, result.text);
      } else this.emit({ type: 'notification', title: 'Scheduled task', body: result.text, sessionId: session.id });
    } catch (e) { throw new Error(this.clean(e instanceof Error ? e.message : String(e))); }
  }
  async close(): Promise<void> {
    this.closed = true;
    const runs = [...this.runs.values()];
    for (const run of runs) run.controller.abort();
    await Promise.allSettled(runs.map(r => r.result));
    this.listeners.clear();
  }
}
