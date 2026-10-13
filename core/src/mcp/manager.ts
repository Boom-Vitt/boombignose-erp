import type { McpServerConfig, Tool } from '../types.ts';
import type { ToolSpec } from '../types.ts';
import { createHash } from 'node:crypto';
import { McpClient } from './client.ts';

interface Entry { client: McpClient; specs: ToolSpec[]; error?: string }
export class McpManager {
  private servers: Record<string, McpServerConfig>;
  private env: Record<string, string>;
  private entries = new Map<string, Entry>();
  private testing = new Set<McpClient>();
  private generation = 0;
  constructor(servers: Record<string, McpServerConfig>, env: Record<string, string>) { this.servers = structuredClone(servers); this.env = { ...env }; }
  async start(): Promise<void> {
    const generation = this.generation;
    for (const [name, config] of Object.entries(this.servers)) {
      if (generation !== this.generation) return;
      if (!config.enabled || this.entries.get(name)?.client.connected) continue;
      await this.entries.get(name)?.client.close();
      if (generation !== this.generation) return;
      const entry: Entry = { client: new McpClient(config, this.env), specs: [] }; this.entries.set(name, entry);
      try { await entry.client.connect(); entry.specs = await entry.client.listTools(); }
      catch (e) { entry.error = e instanceof Error ? e.message : String(e); await entry.client.close(); }
    }
  }
  tools(): Tool[] {
    const output: Tool[] = [], names = new Set<string>();
    for (const [server, entry] of this.entries) {
      if (!entry.client.connected) continue;
      const selected = this.servers[server]?.tools;
      for (const spec of entry.specs) {
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
        output.push({ ...spec, name, defaultPolicy: 'ask', run: (input, ctx) => entry.client.callTool(spec.name, input, ctx.signal) });
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
  status(): { name: string; transport: 'stdio' | 'http'; enabled: boolean; connected: boolean; tools: { name: string; selected: boolean }[]; error?: string }[] {
    return Object.entries(this.servers).map(([name, config]) => {
      const entry = this.entries.get(name);
      return { name, transport: config.transport, enabled: config.enabled, connected: entry?.client.connected ?? false,
        tools: (entry?.specs ?? []).map(t => ({ name: t.name, selected: !config.tools || config.tools.includes(t.name) })),
        ...(entry?.error ? { error: entry.error } : {}),
      };
    });
  }
  listTools(name: string): ToolSpec[] { return structuredClone(this.entries.get(name)?.specs ?? []); }
  async update(servers: Record<string, McpServerConfig>, env = this.env): Promise<void> {
    const generation = this.generation;
    const envChanged = JSON.stringify(env) !== JSON.stringify(this.env);
    for (const [name, entry] of this.entries) {
      if (envChanged || JSON.stringify(this.servers[name]) !== JSON.stringify(servers[name])) { await entry.client.close(); this.entries.delete(name); }
    }
    this.env = { ...env };
    this.servers = structuredClone(servers);
    if (generation === this.generation) await this.start();
  }
  async stop(): Promise<void> {
    this.generation++;
    for (const client of this.testing) await client.close();
    this.testing.clear();
    for (const entry of this.entries.values()) await entry.client.close();
    this.entries.clear();
  }
}
