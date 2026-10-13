import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { ensureApiToken, homeDir, loadConfig, paths, readEnv, saveConfig, VERSION } from '../config.ts';
import { openStore } from '../store/index.ts';
import { McpManager } from '../mcp/manager.ts';
import { Scheduler } from '../cron/index.ts';
import type { SchedulerOptions } from '../cron/index.ts';
import { createLineGateway } from '../line/index.ts';
import type { LineGateway, LineGatewayOptions } from '../line/index.ts';
import { createApiServer } from '../api/index.ts';
import type { Config } from '../types.ts';
import { Runtime } from './runtime.ts';
import type { RuntimeOptions } from './runtime.ts';
import { restoreMaskedConfig, validateConfig } from './settings.ts';

export interface DaemonOptions {
  home?: string; providerFactory?: RuntimeOptions['providerFactory'];
  signal?: AbortSignal;
  lineOptions?: Pick<LineGatewayOptions, 'fetchImpl' | 'apiBase' | 'timers'>;
  schedulerOptions?: Pick<SchedulerOptions, 'now' | 'setTimer'>;
}
export async function startDaemon(options: DaemonOptions = {}) {
  const home = options.home ?? homeDir();
  let config = loadConfig(home); validateConfig(config);
  const token = ensureApiToken(home), store = openStore(paths(home).db);
  const mcp = new McpManager(config.mcp.servers, readEnv(home));
  let line: LineGateway | undefined, lineFingerprint = '', lineError: string | undefined;
  const scheduler = new Scheduler({ store, onFire: job => runtime.fireJob(job), ...options.schedulerOptions });
  const runtime = new Runtime({ home, token, store, mcp, scheduler, config: () => config, line: () => line, providerFactory: options.providerFactory });
  let operation: Promise<void> = Promise.resolve(), closed = false, closing: Promise<void> | undefined;
  const serial = (fn: () => Promise<void>) => {
    const next = operation.then(fn); operation = next.catch(() => {}); return next;
  };
  async function reload(): Promise<void> {
    if (closed) return;
    const env = readEnv(home);
    const fingerprint = JSON.stringify([config.line, env.LINE_CHANNEL_ACCESS_TOKEN, env.LINE_CHANNEL_SECRET]);
    if (fingerprint !== lineFingerprint) {
      await line?.close(); line = undefined; lineError = undefined; lineFingerprint = fingerprint;
      if (closed) return;
      if (config.line.enabled && env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET) {
        const gateway = createLineGateway({ config: structuredClone(config.line), channelSecret: env.LINE_CHANNEL_SECRET, accessToken: env.LINE_CHANNEL_ACCESS_TOKEN,
          onMessage: m => runtime.lineMessage(m), ...options.lineOptions });
        try { await gateway.listen(config.line.port); line = gateway; }
        catch (e) { await gateway.close(); lineFingerprint = ''; lineError = runtime.clean(e instanceof Error ? e.message : String(e)); }
      }
    }
    if (closed) return;
    scheduler.start();
    await mcp.update(config.mcp.servers, env);
  }
  function lineStatus() {
    const env = readEnv(home), status = line?.status();
    const webhookUrl = config.line.publicUrl ? config.line.publicUrl.replace(/\/+$/, '') + '/line/webhook' : undefined;
    return { enabled: config.line.enabled, running: status?.running ?? false, port: status?.port ?? config.line.port,
      publicUrl: config.line.publicUrl, webhookUrl, tokenSet: !!env.LINE_CHANNEL_ACCESS_TOKEN, secretSet: !!env.LINE_CHANNEL_SECRET,
      lastEventAt: status?.lastEventAt, lastError: status?.lastError ?? lineError };
  }
  const api = createApiServer({ home, token, runtime, mcp, scheduler, config: () => config, lineStatus,
    updateSettings: input => serial(async () => {
      if (closed) throw new Error('daemon is closing');
      const value = typeof input === 'function' ? input(structuredClone(config)) : input;
      validateConfig(value);
      const next = restoreMaskedConfig(value, config);
      saveConfig(next, home); config = next; await reload();
    }),
    reloadSecrets: () => serial(reload),
  });
  function close(): Promise<void> {
    if (closing) return closing;
    closed = true; scheduler.stop(); options.signal?.removeEventListener('abort', abort);
    closing = (async () => {
      await api.close(); await mcp.stop(); await operation;
      await line?.close(); await runtime.close(); store.close();
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
    const port = await api.listen(config.api.port);
    options.signal?.throwIfAborted();
    const file = paths(home).daemon, tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ pid: process.pid, port, version: VERSION, startedAt: Date.now() }) + '\n', { mode: 0o600 });
    renameSync(tmp, file);
    void serial(reload).catch(e => runtime.emit({ type: 'notification', title: 'Connector startup failed', body: String(e) }));
    return { home, token, port, runtime, mcp, scheduler, lineStatus, config: () => structuredClone(config), close };
  } catch (e) { await close(); throw e; }
}
