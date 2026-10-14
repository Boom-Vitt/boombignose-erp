import type { McpServerConfig, ToolSpec, ToolResult } from '../types.ts';
import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { maskSecret, VERSION } from '../config.ts';
import { readSse } from '../providers/sse.ts';

type Rpc = { jsonrpc: string; id?: string | number; method?: string; params?: unknown; result?: any; error?: { code: number; message: string } };
export class McpClient {
  readonly config: McpServerConfig;
  readonly env: Record<string, string>;
  connected = false;
  private failure?: Error;
  private child?: ChildProcessWithoutNullStreams;
  private pending = new Map<number, { resolve: (value: any) => void; reject: (error: Error) => void }>();
  private sequence = 0;
  private stderr = '';
  private session?: string;
  private version = '2025-11-25';
  private headers: Record<string, string> = {};
  private controller = new AbortController();
  private closed = true;
  private values: string[];

  constructor(config: McpServerConfig, env: Record<string, string> = {}) {
    this.config = structuredClone(config); this.env = { ...env };
    this.values = [...Object.values(env), ...Object.values(config.transport === 'stdio' ? config.env ?? {} : config.headers ?? {})];
  }
  private redact(text: string): string {
    const variants = this.values.filter(value => value.length >= 8).flatMap(value => [value, JSON.stringify(value).slice(1, -1)]
      .map(form => ({ form, masked: maskSecret(value) })));
    for (const { form, masked } of variants.filter(v => v.form).sort((a, b) => b.form.length - a.form.length)) text = text.split(form).join(masked);
    return text;
  }
  private safe(text: string): Error {
    return new Error(this.redact(text).slice(0, 2000));
  }
  private expand(value: string): string {
    return value.replace(/\$\{([A-Z_][A-Z0-9_]*)\}/g, (_, name) => {
      if (!Object.hasOwn(this.env, name)) throw new Error(`Missing environment reference: ${name}`);
      return this.env[name]!;
    });
  }
  private fail(error: Error): void {
    this.connected = false;
    this.failure ??= error;
    for (const p of this.pending.values()) p.reject(this.failure);
    this.pending.clear();
  }
  get disconnectReason(): string | undefined {
    const message = this.failure?.message;
    return message === undefined ? undefined : message.startsWith('MCP server exited (')
      ? message.slice('MCP server '.length) : `closed: ${message}`;
  }
  async connect(): Promise<void> {
    if (this.connected) return;
    this.closed = false; this.failure = undefined; this.controller = new AbortController(); this.stderr = ''; this.session = undefined; this.version = '2025-11-25';
    try {
      if (this.config.transport === 'stdio') {
        const env = Object.fromEntries(Object.entries(this.config.env ?? {}).map(([k, v]) => [k, this.expand(v)]));
        this.child = spawn(this.config.command, this.config.args ?? [], { env: { ...process.env, ...env }, stdio: 'pipe', detached: true });
        this.child.stderr.on('data', (chunk: Buffer) => { this.stderr = (this.stderr + chunk.toString()).slice(-8000); });
        this.child.stdin.on('error', e => this.fail(this.safe(e.message)));
        this.child.on('error', e => this.fail(this.safe(e.message)));
        this.child.on('exit', (code, signal) => this.fail(this.safe(`MCP server exited (${code ?? signal}): ${this.stderr}`)));
        const lines = createInterface({ input: this.child.stdout });
        lines.on('line', line => {
          try { void this.receive(JSON.parse(line)).catch(e => this.fail(this.safe(String(e)))); }
          catch { /* Ignore non-protocol stdout such as startup banners. */ }
        });
      } else this.headers = Object.fromEntries(Object.entries(this.config.headers ?? {}).map(([k, v]) => [k, this.expand(v)]));
      const result = await this.request('initialize', { protocolVersion: this.version, capabilities: {}, clientInfo: { name: 'BigNose', version: VERSION } }, undefined, this.config.transport === 'stdio' ? 180_000 : 60_000);
      if (typeof result?.protocolVersion !== 'string') throw new Error('Invalid MCP initialize result');
      this.version = result.protocolVersion;
      await this.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      this.connected = true;
    } catch (e) { await this.close(); throw this.safe(e instanceof Error ? e.message : String(e)); }
  }
  private unwrap(message: Rpc): any {
    if (message.error) throw this.safe(`MCP error ${message.error.code}: ${message.error.message}`);
    return message.result;
  }
  private async receive(message: Rpc): Promise<void> {
    if (message.jsonrpc !== '2.0') return;
    if (message.method) {
      if (message.method === 'ping' && message.id !== undefined) await this.send({ jsonrpc: '2.0', id: message.id, result: {} });
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    try { pending.resolve(this.unwrap(message)); } catch (e) { pending.reject(e as Error); }
  }
  private async post(message: Rpc, signal?: AbortSignal, timeoutMs = 60_000): Promise<any> {
    if (this.config.transport !== 'http') throw new Error('Not an HTTP server');
    const response = await fetch(this.config.url, {
      method: 'POST', redirect: 'error', signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : [])]),
      headers: { ...this.headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        ...(this.session ? { 'Mcp-Session-Id': this.session } : {}), 'MCP-Protocol-Version': this.version },
      body: JSON.stringify(message),
    });
    if (!response.ok) throw this.safe(`MCP HTTP ${response.status}: ${await response.text()}`);
    if (message.method === 'initialize') this.session = response.headers.get('mcp-session-id') ?? undefined;
    if (response.status === 202 && (message.id === undefined || !message.method)) return;
    if (response.headers.get('content-type')?.includes('text/event-stream')) {
      if (!response.body) throw new Error('Empty MCP response');
      for await (const event of readSse(response.body)) {
        if (!event.data) continue;
        const value: Rpc = JSON.parse(event.data);
        if (value.jsonrpc !== '2.0') continue;
        if (!value.method && value.id === message.id && message.id !== undefined) return this.unwrap(value);
        await this.receive(value);
      }
      throw new Error('MCP stream ended without a response');
    }
    const value: Rpc = await response.json();
    if (value.jsonrpc !== '2.0' || value.id !== message.id || value.method) throw new Error('Invalid MCP response');
    return this.unwrap(value);
  }
  private async send(message: Rpc): Promise<void> {
    if (this.failure) throw this.failure;
    if (this.closed) throw new Error('MCP client is closed');
    if (this.config.transport === 'http') { await this.post(message); return; }
    if (!this.child?.stdin.writable) throw new Error('MCP server is not running');
    this.child.stdin.write(JSON.stringify(message) + '\n');
  }
  private request(method: string, params: unknown, signal?: AbortSignal, timeoutMs = 60_000): Promise<any> {
    if (this.failure) return Promise.reject(this.failure);
    if (this.closed) return Promise.reject(new Error('MCP client is closed'));
    const id = ++this.sequence, message: Rpc = { jsonrpc: '2.0', id, method, params };
    if (this.config.transport === 'http') return this.post(message, signal, timeoutMs);
    return new Promise((resolve, reject) => {
      const finish = (error?: Error, value?: any) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id);
        error ? reject(error) : resolve(value);
      };
      const abort = () => finish(new Error('interrupted'));
      const timer = setTimeout(() => finish(this.safe(`MCP request timeout: ${method}; ${this.stderr}`)), timeoutMs);
      this.pending.set(id, { resolve: value => finish(undefined, value), reject: error => finish(error) });
      if (signal?.aborted) { abort(); return; }
      signal?.addEventListener('abort', abort, { once: true });
      this.send(message).catch(e => finish(this.safe(String(e))));
    });
  }
  async listTools(): Promise<ToolSpec[]> {
    const tools: ToolSpec[] = [], cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.request('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(page?.tools)) throw new Error('Invalid MCP tools list');
      for (const t of page.tools) {
        if (typeof t.name !== 'string' || !t.name) throw new Error('Invalid MCP tool name');
        tools.push({ name: t.name, description: t.description ?? '', inputSchema: t.inputSchema ?? { type: 'object' } });
      }
      cursor = page.nextCursor;
      if (cursor) { if (typeof cursor !== 'string' || cursors.has(cursor)) throw new Error('Invalid MCP pagination cursor'); cursors.add(cursor); }
    } while (cursor);
    return tools;
  }
  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<ToolResult> {
    try {
      const result = await this.request('tools/call', { name, arguments: args }, signal);
      if (!Array.isArray(result?.content)) throw new Error('Invalid MCP tool result');
      const content = result.content.filter((c: any) => c.type === 'text' && typeof c.text === 'string').map((c: any) => c.text).join('\n');
      const bytes = Buffer.from(this.redact(content));
      const note = '\n[Tool result truncated at 100 kB]';
      const bounded = bytes.length <= 100_000 ? bytes.toString('utf8')
        : new TextDecoder().decode(bytes.subarray(0, 100_000 - Buffer.byteLength(note)), { stream: true }) + note;
      return { content: bounded, ...(result.isError ? { isError: true } : {}) };
    } catch (e) { return { content: this.safe(e instanceof Error ? e.message : String(e)).message, isError: true }; }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true; this.connected = false;
    this.controller.abort(); this.fail(new Error('MCP client is closed'));
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null && child.pid) {
      const closed = new Promise<void>(resolve => child.once('close', () => resolve()));
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      await closed;
    }
    if (this.config.transport === 'http' && this.session) {
      await fetch(this.config.url, { method: 'DELETE', redirect: 'error', headers: { ...this.headers, 'Mcp-Session-Id': this.session, 'MCP-Protocol-Version': this.version }, signal: AbortSignal.timeout(2000) }).then(r => r.body?.cancel()).catch(() => {});
    }
    this.session = undefined;
  }
}
