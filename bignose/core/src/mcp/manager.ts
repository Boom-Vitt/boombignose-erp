import type { McpServerConfig, Tool } from '../types.ts';
import type { ToolSpec } from '../types.ts';
import { createHash } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { McpClient } from './client.ts';

interface Entry { client: McpClient; specs?: ToolSpec[]; error?: string; starting?: Promise<void> }
const REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;
// The variables a connector's config expands at connect time (stdio env values, HTTP header values).
const refs = (config?: McpServerConfig) => Object.values((config?.transport === 'stdio' ? config.env : config?.headers) ?? {}).flatMap(v => [...v.matchAll(REF)].map(m => m[1]!));
export class McpManager {
  private servers: Record<string, McpServerConfig>;
  private env: Record<string, string>;
  private entries = new Map<string, Entry>();
  private testing = new Set<McpClient>();
  private generation = 0;
  constructor(servers: Record<string, McpServerConfig>, env: Record<string, string>) { this.servers = structuredClone(servers); this.env = { ...env }; }
  /** Connects every enabled connector that is not up, all at once, and resolves when each has connected or failed. */
  async start(): Promise<void> { this.launch(); await this.ready(); }
  async ready(): Promise<void> { await Promise.all([...this.entries.values()].map(e => e.starting)); }
  /** Waits up to `ms` for the named connectors that are still starting; never throws. */
  async settle(names: string[], ms: number, signal: AbortSignal): Promise<void> {
    const pending = names.flatMap(name => this.entries.get(name)?.starting ?? []);
    if (!pending.length) return;
    const done = new AbortController();
    try { await Promise.race([Promise.all(pending), setTimeout(ms, undefined, { signal: AbortSignal.any([done.signal, signal]) })]); }
    catch { /* interrupted: the caller checks its own signal */ }
    finally { done.abort(); }
  }
  // A connector that failed to start is left alone until its config or a variable it references changes; one that was up and exited is restarted.
  private launch(): string[] {
    const launched: string[] = [];
    for (const [name, config] of Object.entries(this.servers)) {
      const previous = this.entries.get(name);
      if (!config.enabled || previous?.client.connected || previous?.starting || (previous?.error && previous.specs === undefined)) continue;
      const entry: Entry = { client: new McpClient(config, this.env) }; this.entries.set(name, entry); launched.push(name);
      entry.starting = (async () => {
        try {
          await previous?.client.close();
          if (this.entries.get(name) !== entry) return; // stop() or apply() replaced us meanwhile: a client connected now would belong to nobody
          await entry.client.connect(); entry.specs = await entry.client.listTools();
        } catch (e) { entry.error = `connector ${name}: ${e instanceof Error ? e.message : String(e)}`; await entry.client.close(); }
        finally { entry.starting = undefined; }
      })();
    }
    return launched;
  }
  async waitFor(names: string[], signal: AbortSignal): Promise<void> {
    const deadline = Date.now() + 180_000;
    while (names.length) {
      signal.throwIfAborted();
      const statuses = this.status();
      for (const name of names) {
        const server = statuses.find(s => s.name === name);
        if (!server?.enabled) throw new Error(`connector ${name} is off`);
        if (server.error) throw new Error(server.error);
      }
      if (names.every(name => statuses.some(s => s.name === name && s.connected))) return;
      if (Date.now() >= deadline) throw new Error(`connector startup timeout: ${names.join(', ')}`);
      await setTimeout(25, undefined, { signal });
    }
  }
  tools(): Tool[] {
    const output: Tool[] = [], names = new Set<string>();
    for (const [server, entry] of this.entries) {
      if (!entry.client.connected) continue;
      const selected = this.servers[server]?.tools;
      for (const spec of entry.specs ?? []) {
        if (selected && !selected.includes(spec.name)) continue;
        const original = `mcp__${server}__${spec.name}`;
        const raw = original.replace(/[^a-zA-Z0-9_-]/g, '_');
        let name = raw;
        if (raw !== original || raw.length > 64) {
          const hash = createHash('sha256').update(server + '\0' + spec.name).digest('hex').slice(0, 10);
          name = raw.slice(0, 53) + '_' + hash;
        }
        if (names.has(name)) continue; // duplicate server tool descriptors represent the same callable tool
        names.add(name);
        output.push({ ...spec, name, defaultPolicy: 'ask', run: async (input, ctx) => {
          const error = this.connectionError(server, entry);
          if (error) return { content: error, isError: true };
          const result = await entry.client.callTool(spec.name, input, ctx.signal);
          const disconnected = this.connectionError(server, entry);
          return disconnected ? { content: disconnected, isError: true } : result;
        } });
      }
    }
    return output;
  }
  async test(name: string): Promise<{ ok: boolean; tools: number; error?: string }> {
    const config = Object.hasOwn(this.servers, name) ? this.servers[name] : undefined;
    if (!config) return { ok: false, tools: 0, error: 'Unknown MCP server' };
    const client = new McpClient(config, this.env);
    this.testing.add(client);
    try { await client.connect(); return { ok: true, tools: (await client.listTools()).length }; }
    catch (e) { return { ok: false, tools: 0, error: e instanceof Error ? e.message : String(e) }; }
    finally { this.testing.delete(client); await client.close(); }
  }
  status(): { name: string; transport: 'stdio' | 'http'; enabled: boolean; connected: boolean; starting: boolean; tools: { name: string; selected: boolean }[]; error?: string }[] {
    return Object.entries(this.servers).map(([name, config]) => {
      const entry = this.entries.get(name);
      if (entry) this.connectionError(name, entry);
      return { name, transport: config.transport, enabled: config.enabled, connected: !!entry?.client.connected && entry.specs !== undefined, starting: config.enabled && (!entry || !!entry.starting), // enabled but not launched yet counts: it is about to start
        tools: (entry?.specs ?? []).map(t => ({ name: t.name, selected: !config.tools || config.tools.includes(t.name) })),
        ...(entry?.error ? { error: entry.error } : {}),
      };
    });
  }
  private connectionError(name: string, entry: Entry): string | undefined {
    if (entry.specs !== undefined && !entry.client.connected) entry.error ??= `connector ${name} ${entry.client.disconnectReason ?? 'closed'}`;
    return entry.error;
  }
  listTools(name: string): ToolSpec[] { return structuredClone(this.entries.get(name)?.specs ?? []); }
  /** Applies new settings: closes connectors whose config (or a variable it references) changed and starts the rest in the background. Returns the names it started. */
  async apply(servers: Record<string, McpServerConfig>, env = this.env): Promise<string[]> {
    const generation = this.generation;
    const changed = new Set([...Object.keys(env), ...Object.keys(this.env)].filter(k => env[k] !== this.env[k]));
    const stale: McpClient[] = [];
    for (const [name, entry] of this.entries) {
      if (JSON.stringify(this.servers[name]) !== JSON.stringify(servers[name]) || refs(servers[name]).some(v => changed.has(v))) { this.entries.delete(name); stale.push(entry.client); }
    }
    this.env = { ...env }; // set before any await, so a start() or a second apply() during the closes sees the new settings
    this.servers = structuredClone(servers);
    await Promise.all(stale.map(client => client.close()));
    return generation === this.generation ? this.launch() : [];
  }
  async update(servers: Record<string, McpServerConfig>, env = this.env): Promise<void> { await this.apply(servers, env); await this.ready(); }
  async stop(): Promise<void> {
    this.generation++;
    const entries = [...this.entries.values()]; this.entries.clear();
    for (const client of this.testing) await client.close();
    this.testing.clear();
    for (const entry of entries) await entry.client.close();
  }
}
