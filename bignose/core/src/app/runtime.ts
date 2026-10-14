import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { CommandError, expandSlash } from '../commands/index.ts';
import { runAgent } from '../agent/loop.ts';
import type { RunResult } from '../agent/loop.ts';
import { withAbort } from '../agent/abort.ts';
import { effectivePolicy } from '../agent/permissions.ts';
import { paths, readEnv } from '../config.ts';
import { createProvider } from '../providers/index.ts';
import { builtinTools } from '../tools/index.ts';
import { memoryPrompt, memoryTools, sessionSearchTool } from '../memory/tools.ts';
import { listSkills, loadSkill, skillsIndex, skillTools } from '../skills/index.ts';
import { scheduleTools } from '../cron/index.ts';
import type { Scheduler } from '../cron/index.ts';
import type { Store, Job } from '../store/index.ts';
import type { McpManager } from '../mcp/manager.ts';
import type { LineGateway } from '../line/index.ts';
import type { Agent, AgentEvent, ApprovalRequest, Approver, Config, HooksConfig, Message, Origin, Policy, ProviderConfig, Tool } from '../types.ts';
import { createCleaner, safeValue } from './settings.ts';

export type ApiEvent = (AgentEvent & { sessionId: string; runId: string })
  | { type: 'run_start'; sessionId: string; runId: string }
  | { type: 'session_updated'; sessionId: string }
  | { type: 'notification'; title: string; body: string; sessionId?: string };
export interface RunProfile {
  provider: ProviderConfig; model: string; system: string; permissions: Record<string, Policy>;
  hooks: HooksConfig; cwd: string; maxTurns: number; maxTokens: number; contextWindow: number; compactAt: number;
  toolFilter?: (tool: Tool) => boolean;
  memory?: string; // Kept separate so every profile can omit automatic notes for non-owner LINE runs.
}
export interface RuntimeOptions {
  home: string; token?: string; store: Store; mcp: McpManager; scheduler: Scheduler;
  config: () => Config; line: () => LineGateway | undefined;
  providerFactory?: typeof createProvider;
}
interface ActiveRun { runId: string; controller: AbortController; result: Promise<RunResult> }
interface PendingApproval { event: ApiEvent; decide: (ok: boolean) => void }

function saveReport(home: string, target: string, text: string): string {
  const dir = join(home, 'reports');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  if (!lstatSync(dir).isDirectory() || lstatSync(dir).isSymbolicLink()) throw new Error('reports must be a regular directory');
  chmodSync(dir, 0o700);
  const name = basename(target).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'target';
  let time = Date.now(), file: string;
  do {
    const stamp = new Date(time).toISOString().slice(0, 19).replace(/[-:T]/g, '').replace(/^(\d{8})(\d{6})$/, '$1-$2');
    file = join(dir, `rea-${name}-${stamp}.md`); time += 1000;
  } while (existsSync(file));
  writeFileSync(file, text, { mode: 0o600, flag: 'wx' });
  return file;
}

export class Runtime {
  readonly store: Store;
  private opts: RuntimeOptions;
  private runs = new Map<string, ActiveRun>();
  private approvals = new Map<string, PendingApproval>();
  private listeners = new Set<(event: ApiEvent) => void>();
  private deletingAgents = new Set<string>();
  private closed = false;
  constructor(opts: RuntimeOptions) {
    this.opts = opts; this.store = opts.store;
    const c = opts.config();
    this.store.ensureDefaultAgent({ ...c.active, instructions: c.agent.systemPrompt ?? '' });
  }
  lineAgent(): Agent {
    const id = this.opts.config().line.agentId;
    return (id && this.store.getAgent(id)) || this.store.listAgents()[0]!;
  }
  cleaner() { return createCleaner(this.opts.home, this.opts.config(), this.opts.token); }
  clean = (text: string) => this.cleaner()(text);
  emit(event: ApiEvent): void {
    const safe = safeValue(event, this.cleaner());
    for (const listener of this.listeners) listener(safe);
  }
  subscribe(listener: (event: ApiEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  replay(): ApiEvent[] {
    return [...[...this.runs].map(([sessionId, run]) => ({ type: 'run_start' as const, sessionId, runId: run.runId })), ...this.pendingEvents()];
  }
  pendingEvents(): ApiEvent[] {
    const clean = this.cleaner();
    return [...this.approvals.values()].map(a => safeValue(a.event, clean));
  }
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
  profile(config = this.opts.config(), includeMemory = true, agent?: Agent): RunProfile {
    const c = structuredClone(config);
    const providerId = agent?.provider ?? c.active.provider;
    const provider = c.providers.find(p => p.id === providerId);
    if (!provider) throw new Error(`provider is not configured: ${providerId}`);
    const maxTokens = agent?.maxTokens ?? provider.maxTokens;
    if (maxTokens !== undefined) provider.maxTokens = maxTokens;
    return {
      provider, model: agent?.model ?? c.active.model,
      system: [(agent ? agent.instructions : c.agent.systemPrompt) || 'You are BigNose, a helpful personal assistant. Use tools carefully and ask when permission is needed.',
        skillsIndex(paths(this.opts.home).skills, agent?.skills), `Today: ${new Date().toLocaleDateString('sv-SE')}`].filter(Boolean).join('\n\n'),
      memory: includeMemory ? memoryPrompt(this.store, agent?.id ?? this.store.listAgents()[0]!.id) : '',
      permissions: { ...c.permissions, ...agent?.permissions }, hooks: c.hooks, cwd: c.agent.workspace, maxTurns: c.agent.maxTurns,
      maxTokens: maxTokens ?? 8192, contextWindow: provider.contextWindow ?? 128000, compactAt: c.agent.compactAt,
    };
  }
  private async approve(req: ApprovalRequest, runId: string, signal: AbortSignal, redaction: (text: string) => string, cliApprove?: Approver): Promise<boolean> {
    const origin = req.origin;
    const delivery = origin.kind === 'cron' ? this.store.listJobs().find(j => j.id === origin.jobId)?.delivery : undefined;
    if (origin.kind === 'line' || delivery?.kind === 'line') {
      const to = origin.kind === 'line' ? origin.to : delivery!.kind === 'line' ? delivery!.to : '';
      const gateway = this.opts.line();
      if (!gateway) return false;
      return withAbort(gateway.askApproval(to, this.clean(redaction(`${req.tool}\n${JSON.stringify(req.input)}`))), signal).catch(() => false);
    }
    if (origin.kind === 'cli') {
      if (!cliApprove) return false;
      return withAbort(cliApprove(safeValue(req, redaction)), AbortSignal.any([signal, AbortSignal.timeout(600_000)])).catch(() => false);
    }
    const event: ApiEvent = safeValue({ type: 'approval_request', approvalId: req.id, sessionId: req.sessionId, runId, tool: req.tool, input: req.input }, redaction);
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
    if (this.deletingAgents.has(session.agentId)) throw new Error('agent is being deleted');
    if (this.runs.has(sessionId)) throw new Error('session is already running');
    const config = structuredClone(this.opts.config()), origin = options.origin ?? session.origin;
    const agent = this.store.getAgent(session.agentId);
    const nonOwner = origin.kind === 'line' && !config.line.allow.users.includes(options.userId ?? '');
    const slash = nonOwner ? undefined : expandSlash(input, listSkills(paths(this.opts.home).skills).filter(s => agent?.skills == null || agent.skills.includes(s.name)),
      { cwd: options.profile?.cwd ?? config.agent.workspace });
    if (slash && 'error' in slash) throw new CommandError(slash.error);
    for (const name of slash?.connectors ?? []) {
      if (!config.mcp.servers[name]?.enabled || (agent?.connectors != null && !agent.connectors.includes(name)))
        throw new CommandError(`connector ${name} is off for this agent`, 409, name);
    }
    const context = nonOwner ? session.context.flatMap(m => {
      if (m.role === 'assistant' && m.content.some(b => b.type === 'tool_use')) return [];
      const content = m.content.filter(b => b.type === 'text' && !b.text.startsWith('[Summary of earlier conversation]\n'));
      return content.length ? [{ ...m, content }] : [];
    }) : session.context;
    const suppliedProfile = options.profile ? { ...options.profile, provider: structuredClone(options.profile.provider),
      permissions: { ...options.profile.permissions }, hooks: structuredClone(options.profile.hooks) } : undefined;
    const env = readEnv(this.opts.home);
    const controller = new AbortController(), runId = randomUUID();
    const redaction = this.cleaner();
    let textTail = '';
    const streamText = (text = '', flush = false) => {
      // Redact the joined buffer before cutting it, so a complete secret cannot straddle the release boundary.
      const current = this.cleaner();
      textTail = current(redaction(textTail + text));
      const cut = flush ? textTail.length : Math.max(0, textTail.length - Math.max(0, Math.max(redaction.maxSecretLength, current.maxSecretLength) - 1));
      if (cut) this.emit({ type: 'text_delta', text: textTail.slice(0, cut), sessionId, runId });
      textTail = textTail.slice(cut);
    };
    // Start after the run is registered, so even an immediate provider completion cannot race the API.
    const result = Promise.resolve().then(async () => {
      let raw: RunResult;
      try {
        if (!agent) throw new Error(`unknown agent: ${session.agentId}`);
        const profile = suppliedProfile ?? this.profile(config, !nonOwner, agent);
        let modelInput = input;
        if (slash) {
          await this.opts.mcp.waitFor(slash.connectors, controller.signal);
          const bodies = slash.skills.map(name => {
            const skill = loadSkill(paths(this.opts.home).skills, name);
            if (!skill) throw new Error(`skill not found: ${name}`);
            const files = skill.files.length ? `\n\nOther files:\n${skill.files.map(f => `- ${f}`).join('\n')}` : '';
            return `<skill name="${skill.name}" folder="${skill.folder}">${skill.body}${files}</skill>`;
          });
          modelInput = [...bodies, slash.prompt].join('\n\n');
        }
        const allTools = [...builtinTools(this.opts.home), ...memoryTools(this.store, agent.id), sessionSearchTool(this.store, agent.id),
          ...skillTools(paths(this.opts.home).skills, agent.skills), ...scheduleTools(this.opts.scheduler, agent.id),
          ...this.opts.mcp.tools().filter(t => Object.entries(config.mcp.servers).some(([name, server]) => server.enabled &&
            (agent.connectors === null || agent.connectors.includes(name)) && t.name.startsWith(`mcp__${name}__`)))];
        const tools = profile.toolFilter ? allTools.filter(profile.toolFilter) : allTools;
        const permissions = { ...profile.permissions };
        if (nonOwner) for (const tool of tools) if (effectivePolicy(tool, permissions) === 'allow') permissions[tool.name] = 'ask';
        const provider = (this.opts.providerFactory ?? createProvider)(profile.provider, profile.provider.apiKeyEnv ? env[profile.provider.apiKeyEnv] || undefined : undefined);
        raw = await runAgent({ ...profile, system: [profile.system, nonOwner ? '' : profile.memory,
          origin.kind === 'line' ? 'You are replying in a LINE chat. Write plain text: short paragraphs, no Markdown headings, tables or bold markers, and put each URL on its own line. Keep answers brief unless the user asks for detail.' : ''].filter(Boolean).join('\n\n'), provider, tools, permissions, sessionId, origin, signal: controller.signal,
          spillDir: join(this.opts.home, 'tool-results'), redact: text => this.cleaner()(redaction(text)),
          context, input: modelInput, approve: req => this.approve(req, runId, controller.signal, redaction, options.approve),
          onEvent: e => {
            if (e.type === 'text_delta') { streamText(e.text); return; }
            streamText('', true);
            if (!['approval_request', 'approval_result', 'run_end'].includes(e.type)) {
              const event = safeValue({ ...e, sessionId, runId }, redaction);
              // shortcut: cut previews lose a possible secret suffix; redact in the loop if all 2000 characters are needed.
              if (event.type === 'tool_end' && e.type === 'tool_end' && e.output.length === 2000)
                event.output = event.output.slice(0, Math.max(0, event.output.length - Math.max(0, Math.max(redaction.maxSecretLength, this.cleaner().maxSecretLength) - 1)));
              this.emit(event);
            }
          },
        });
      } catch (e) {
        const message: Message = { role: 'user', content: [{ type: 'text', text: input }] };
        raw = { status: controller.signal.aborted ? 'interrupted' : 'error', text: '', error: e instanceof Error ? e.message : String(e),
          context: [...context, message], added: [message], usage: { inputTokens: 0, outputTokens: 0 } };
      }
      const current = this.cleaner(), clean = (text: string) => current(redaction(text)), completed = safeValue(raw, clean);
      const transcript = slash ? [{ role: 'user' as const, content: [{ type: 'text' as const, text: clean(input) }] }, ...completed.added.slice(1)] : completed.added;
      this.store.appendMessages(sessionId, transcript);
      this.store.setContext(sessionId, nonOwner ? [...safeValue(session.context, clean),
        { role: 'user', content: [{ type: 'text', text: clean(input) }] },
        ...(completed.status !== 'error' && completed.text ? [{ role: 'assistant' as const, content: [{ type: 'text' as const, text: completed.text }] }] : [])] : completed.context);
      if (!session.title) this.store.setTitle(sessionId, clean(input).replace(/\s+/g, ' ').slice(0, 80));
      if (slash?.command === 'rea' && slash.target && completed.status === 'done' && completed.text.trim()) {
        try {
          const file = saveReport(this.opts.home, slash.target, completed.text);
          this.emit({ type: 'notification', title: 'Report saved', body: file, sessionId });
        } catch (e) {
          completed.status = 'error'; completed.error = clean(e instanceof Error ? e.message : String(e));
        }
      }
      this.runs.delete(sessionId);
      this.emit({ type: 'run_end', status: completed.status, text: completed.text, ...(completed.error ? { error: completed.error } : {}), sessionId, runId });
      this.emit({ type: 'session_updated', sessionId });
      return completed;
    }).finally(() => { this.runs.delete(sessionId); });
    this.runs.set(sessionId, { runId, controller, result });
    this.emit({ type: 'run_start', sessionId, runId });
    return { runId, result };
  }
  async lineMessage(message: { to: string; userId: string; text: string }): Promise<string> {
    const origin: Origin = { kind: 'line', to: message.to };
    const agentId = this.lineAgent().id;
    const session = this.store.findSessionByOrigin(origin, agentId) ?? this.store.createSession({ origin, agentId });
    let result: RunResult;
    try { result = await this.start(session.id, message.text, { origin, userId: message.userId }).result; }
    catch (e) {
      if (e instanceof CommandError && e.connector) return `Turn on the ${e.connector} connector for this agent in the app, then send again.`;
      if (e instanceof CommandError) return this.clean(e.message);
      throw e;
    }
    return result.status === 'error' ? `Error: ${result.error}` : result.text || `Run ${result.status}.`;
  }
  async fireJob(job: Job): Promise<void> {
    try {
      const origin: Origin = { kind: 'cron', jobId: job.id };
      const session = this.store.createSession({ origin, agentId: job.agentId, title: `Scheduled: ${this.clean(job.prompt).replace(/\s+/g, ' ').slice(0, 60)}` });
      const result = await this.start(session.id, job.prompt, { origin }).result;
      if (result.status !== 'done') throw new Error(result.error ?? `Run ${result.status}`);
      if (job.delivery.kind === 'line') {
        const gateway = this.opts.line();
        if (!gateway) throw new Error('LINE gateway is unavailable');
        await gateway.push(job.delivery.to, result.text);
      } else this.emit({ type: 'notification', title: 'Scheduled task', body: result.text, sessionId: session.id });
    } catch (e) { throw new Error(this.clean(e instanceof Error ? e.message : String(e))); }
  }
  async deleteAgent(agentId: string): Promise<boolean> {
    this.deletingAgents.add(agentId);
    try {
      const runs = [...this.runs].filter(([id]) => this.store.getSession(id)?.agentId === agentId).map(([, run]) => run);
      for (const run of runs) run.controller.abort();
      await Promise.allSettled(runs.map(run => run.result));
      return this.store.deleteAgent(agentId);
    } finally { this.deletingAgents.delete(agentId); }
  }
  async close(): Promise<void> {
    this.closed = true;
    const runs = [...this.runs.values()];
    for (const run of runs) run.controller.abort();
    await Promise.allSettled(runs.map(r => r.result));
    this.listeners.clear();
  }
}
