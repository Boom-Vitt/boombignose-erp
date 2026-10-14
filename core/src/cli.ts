#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { homeDir, loadConfig, paths, readEnv, saveConfig } from './config.ts';
import { McpManager } from './mcp/manager.ts';
import { openStore } from './store/index.ts';
import { Scheduler } from './cron/index.ts';
import { startDaemon } from './app/daemon.ts';
import { doctor } from './app/doctor.ts';
import { Runtime } from './app/runtime.ts';
import { safeText, validateConfig, validateMcpName, validateMcpServer } from './app/settings.ts';
import type { McpServerConfig } from './types.ts';

export async function main(args = process.argv.slice(2)): Promise<number> {
  const home = homeDir();
  if (args[0] === 'doctor') { const result = await doctor(home); for (const line of result.lines) console.log(line); return result.code; }
  const config = loadConfig(home); validateConfig(config);
  const clean = (s: string) => safeText(s, home, config);
  if (args[0] === 'daemon') {
    const controller = new AbortController(), stop = () => controller.abort();
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    try {
      const daemon = await startDaemon({ home, signal: controller.signal });
      process.stderr.write(`BigNose listening on 127.0.0.1:${daemon.port}\n`);
      if (!controller.signal.aborted) await new Promise<void>(resolve => controller.signal.addEventListener('abort', () => resolve(), { once: true }));
      await daemon.close(); return 0;
    } catch (e) { if (!controller.signal.aborted) throw e; return 0; }
    finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); }
  }
  if (args[0] === 'chat') {
    if (args[1] !== '-q' || !args[2]?.trim() || args.length !== 3) throw new Error('usage: bignose chat -q "<prompt>"');
    const store = openStore(paths(home).db), mcp = new McpManager(config.mcp.servers, readEnv(home));
    const scheduler = new Scheduler({ store, onFire: async () => {} });
    const runtime = new Runtime({ home, store, mcp, scheduler, config: () => config, line: () => undefined });
    const controller = new AbortController();
    const session = store.createSession({ origin: { kind: 'cli' }, agentId: store.listAgents()[0]!.id });
    const stop = () => { controller.abort(); runtime.interrupt(session.id); void mcp.stop(); };
    process.on('SIGINT', stop); process.on('SIGTERM', stop);
    runtime.subscribe(e => {
      if (e.type === 'text_delta') process.stdout.write(e.text);
      if (e.type === 'tool_start') process.stderr.write(`tool ${e.name} ${JSON.stringify(e.input)}\n`);
      if (e.type === 'tool_end') process.stderr.write(`${e.isError ? 'error' : 'result'} ${e.name}: ${e.output}\n`);
    });
    try {
      await mcp.start();
      if (controller.signal.aborted) return 1;
      const result = await runtime.start(session.id, args[2], { approve: async req => {
        if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
        const rl = createInterface({ input: process.stdin, output: process.stderr });
        try {
          const answer = await rl.question(`Allow ${req.tool} ${clean(JSON.stringify(req.input))}? [y/N] `, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(600_000)]) });
          return /^y(es)?$/i.test(answer.trim());
        } finally { rl.close(); }
      } }).result;
      process.stdout.write('\n');
      if (result.error) process.stderr.write(clean(result.error) + '\n');
      return result.status === 'done' ? 0 : 1;
    } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await runtime.close(); await mcp.stop(); store.close(); }
  }
  if (args[0] === 'mcp') {
    const [, action, name] = args;
    if (action === 'list') {
      for (const [name, s] of Object.entries(config.mcp.servers)) console.log(`${name} ${s.transport} ${s.enabled ? 'enabled' : 'disabled'}`);
      return 0;
    }
    validateMcpName(name);
    if (action === 'add') {
      if (Object.hasOwn(config.mcp.servers, name)) throw new Error('MCP server already exists');
      let server: McpServerConfig;
      if (args[3] === '--url' && args.length === 5) server = { transport: 'http', url: args[4]!, enabled: true };
      else if (args[3] === '--' && args[4]) server = { transport: 'stdio', command: args[4], args: args.slice(5), enabled: true };
      else throw new Error('usage: bignose mcp add <name> (--url <url> | -- <command> [args…])');
      validateMcpServer(server); config.mcp.servers[name] = server; saveConfig(config, home); return 0;
    }
    if (!Object.hasOwn(config.mcp.servers, name)) throw new Error('unknown MCP server');
    if (action === 'enable' || action === 'disable') { config.mcp.servers[name]!.enabled = action === 'enable'; saveConfig(config, home); return 0; }
    if (action === 'test') {
      const mcp = new McpManager(config.mcp.servers, readEnv(home));
      const stop = () => { void mcp.stop(); };
      process.on('SIGINT', stop); process.on('SIGTERM', stop);
      try {
        const result = await mcp.test(name);
        console.log(result.ok ? `ok ${name} ${result.tools} tools` : `fail ${name}: ${clean(result.error ?? 'unknown error')}`);
        return result.ok ? 0 : 1;
      } finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await mcp.stop(); }
    }
  }
  throw new Error('usage: bignose daemon | chat -q "<prompt>" | mcp add|list|test|enable|disable | doctor');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }, e => {
    let message = e instanceof Error ? e.message : String(e);
    try { const home = homeDir(); message = safeText(message, home, loadConfig(home)); } catch { message = 'BigNose could not load its configuration'; }
    process.stderr.write(message + '\n'); process.exitCode = 1;
  });
}
