import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ensureApiToken, getApiKey, homeDir, loadConfig, paths, readEnv, saveConfig, VERSION } from '../config.ts';
import { openStore } from '../store/index.ts';
import { McpManager } from '../mcp/manager.ts';
import { Scheduler } from '../cron/index.ts';
import type { SchedulerOptions } from '../cron/index.ts';
import { createLineGateway, publicUrlProblem, webhookUrlFor } from '../line/index.ts';
import type { LineGateway, LineGatewayOptions } from '../line/index.ts';
import { createApiServer } from '../api/index.ts';
import { Runtime } from './runtime.ts';
import type { RuntimeOptions } from './runtime.ts';
import { listModels } from '../providers/models.ts';
import { isOllama, OLLAMA_DEFAULT_MODEL } from '../providers/ollama.ts';
import { validateConfig } from './settings.ts';

export interface DaemonOptions {
  fetchImpl?: typeof fetch;
  home?: string; providerFactory?: RuntimeOptions['providerFactory'];
  signal?: AbortSignal;
  lineOptions?: Pick<LineGatewayOptions, 'fetchImpl' | 'apiBase' | 'timers'>;
  schedulerOptions?: Pick<SchedulerOptions, 'now' | 'setTimer'>;
}
export async function startDaemon(options: DaemonOptions = {}) {
  const home = options.home ?? homeDir();
  let config = loadConfig(home); validateConfig(config);
  const token = ensureApiToken(home), store = openStore(paths(home).db);
  if (!existsSync(paths(home).config) && store.listAgents().length === 0) {
    const provider = config.providers.find(p => p.id === config.active.provider)!;
    if (isOllama(provider)) {
      const fetchImpl = options.fetchImpl ?? fetch;
      try {
        const models = await listModels(provider, getApiKey(config, provider.id, home), (url, init) => fetchImpl(url, {
          ...init, signal: AbortSignal.any([init!.signal!, AbortSignal.timeout(2000), ...(options.signal ? [options.signal] : [])]),
        }));
        if (!models.some(m => m.id === OLLAMA_DEFAULT_MODEL)) {
          config.active.model = models.find(m => m.id.startsWith('qwen3:'))?.id ?? models[0]!.id;
          saveConfig(config, home);
        }
      } catch { /* Keep the default model when Ollama is unavailable or empty. */ }
    }
  }
  const seen = new Set<string>();
  const mcp = new McpManager(config.mcp.servers, readEnv(home));
  let line: LineGateway | undefined, lineFingerprint = '', lineError: string | undefined;
  const scheduler = new Scheduler({ store, onFire: job => runtime.fireJob(job), ...options.schedulerOptions });
  const runtime = new Runtime({ home, token, store, mcp, scheduler, config: () => config, line: () => line, providerFactory: options.providerFactory });
  const testPorts = process.env.BIGNOSE_TEST_PORTS === '0';
  const apiPort = testPorts ? 0 : config.api.port;
  const linePort = () => testPorts && config.line.port === 47822 ? 0 : config.line.port;
  let operation: Promise<void> = Promise.resolve(), closed = false, closing: Promise<void> | undefined;
  const serial = (fn: () => Promise<void>) => {
    const next = operation.then(fn); operation = next.catch(() => {}); return next;
  };
  async function reload(): Promise<void> {
    if (closed) return;
    const env = readEnv(home);
    const { agentId: _agentId, ...listenerConfig } = config.line;
    const fingerprint = JSON.stringify([listenerConfig, env.LINE_CHANNEL_ACCESS_TOKEN, env.LINE_CHANNEL_SECRET]);
    if (fingerprint !== lineFingerprint) {
      lineError = undefined; lineFingerprint = fingerprint;
      const accessToken = env.LINE_CHANNEL_ACCESS_TOKEN, channelSecret = env.LINE_CHANNEL_SECRET;
      if (!config.line.enabled || !accessToken || !channelSecret) { await line?.close(); line = undefined; } // off or unusable: nothing to deliver with
      else if (line) {
        // Hot-apply: a rebuild would drop in-flight answers, queued messages, open approvals and parked "Get answer" answers.
        try { await line.reconfigure({ config: structuredClone(config.line), channelSecret, accessToken }, linePort()); }
        catch (e) { lineFingerprint = ''; lineError = runtime.clean(e instanceof Error ? e.message : String(e)); } // the old listener stays up; retry on the next reload
      } else {
        const gateway = createLineGateway({ config: structuredClone(config.line), channelSecret, accessToken,
          onMessage: m => runtime.lineMessage(m), seen, ...options.lineOptions });
        try { await gateway.listen(linePort()); line = gateway; }
        catch (e) { await gateway.close(); lineFingerprint = ''; lineError = runtime.clean(e instanceof Error ? e.message : String(e)); }
      }
    }
    if (closed) return;
    scheduler.start();
    await mcp.update(config.mcp.servers, env);
  }
  function lineStatus() {
    const env = readEnv(home), status = line?.status();
    const publicUrl = config.line.publicUrl?.trim();
    const webhookUrl = publicUrl ? webhookUrlFor(publicUrl) : undefined;
    const warnings: string[] = [];
    if (!Object.values(config.line.allow).some(ids => ids.length)) warnings.push('Nobody is allowed yet: add your LINE user ID (U…) under Allowed users.');
    const problem = publicUrl && publicUrlProblem(publicUrl);
    if (problem) warnings.push(problem);
    return { enabled: config.line.enabled, running: status?.running ?? false, port: status?.port ?? linePort(),
      agentId: runtime.lineAgent().id,
      publicUrl, webhookUrl, healthUrl: webhookUrl ? webhookUrl + '/health' : undefined, warnings,
      tokenSet: !!env.LINE_CHANNEL_ACCESS_TOKEN, secretSet: !!env.LINE_CHANNEL_SECRET,
      lastEventAt: status?.lastEventAt, lastError: status?.lastError ?? lineError };
  }
  const api = createApiServer({ home, token, fetchImpl: options.fetchImpl, runtime, mcp, scheduler, config: () => config, lineStatus,
    lineApiOptions: () => {
      const env = readEnv(home);
      return { ...options.lineOptions, accessToken: env.LINE_CHANNEL_ACCESS_TOKEN ?? '', channelSecret: env.LINE_CHANNEL_SECRET };
    },
    updateSettings: input => serial(async () => {
      if (closed) throw new Error('daemon is closing');
      const value = typeof input === 'function' ? input(structuredClone(config)) : input;
      validateConfig(value);
      saveConfig(value, home); config = value; await reload();
    }),
    reloadSecrets: () => serial(reload),
  });
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true; scheduler.stop(); options.signal?.removeEventListener('abort', abort);
    closing = (async () => {
      await runtime.close();
      await api.close(); await mcp.stop(); await operation;
      await line?.close(); store.close();
      const file = paths(home).daemon;
      if (existsSync(file)) {
        try { if (JSON.parse(readFileSync(file, 'utf8')).pid === process.pid) rmSync(file, { force: true }); } catch { /* Leave another process's discovery file alone. */ }
      }
    })();
    return closing;
  }
  const abort = () => { void close(); };
  options.signal?.addEventListener('abort', abort, { once: true });
  try {
    options.signal?.throwIfAborted();
    const port = await api.listen(apiPort);
    options.signal?.throwIfAborted();
    const file = paths(home).daemon, tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, port, version: VERSION, startedAt: Date.now() }) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
    void serial(reload).catch(e => runtime.emit({ type: 'notification', title: 'Connector startup failed', body: String(e) }));
    return { home, token, port, runtime, mcp, scheduler, lineStatus, config: () => structuredClone(config), close };
  } catch (e) { await close(); throw e; }
}
