import { defaultConfig, maskSecret, readEnv, redact } from '../config.ts';
import type { Config, McpServerConfig } from '../types.ts';

export const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export function requireValue(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const string = (v: unknown) => typeof v === 'string' && !!v.trim();
const strings = (v: unknown) => Array.isArray(v) && v.every(x => typeof x === 'string');
const integer = (v: unknown, min: number, max = Number.MAX_SAFE_INTEGER) => Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
const url = (v: unknown) => { try { return typeof v === 'string' && ['http:', 'https:'].includes(new URL(v).protocol); } catch { return false; } };
const envName = (v: unknown) => typeof v === 'string' && /^[A-Z_][A-Z0-9_]*$/.test(v);
const reference = (v: string) => /^\$\{[A-Z_][A-Z0-9_]*\}$/.test(v);

export function validateMcpName(name: unknown): asserts name is string {
  requireValue(typeof name === 'string' && /^[a-zA-Z0-9-]{1,32}$/.test(name), 'MCP name must match ^[a-zA-Z0-9-]{1,32}$');
}
export function validateMcpServer(v: unknown): asserts v is McpServerConfig {
  requireValue(isObject(v) && typeof v.enabled === 'boolean', 'invalid MCP config');
  requireValue(v.tools === undefined || strings(v.tools), 'MCP tools must be strings');
  if (v.transport === 'stdio') {
    requireValue(string(v.command) && (v.args === undefined || strings(v.args)), 'MCP command and args are invalid');
    requireValue(v.env === undefined || (isObject(v.env) && Object.entries(v.env).every(([k, x]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(k) && typeof x === 'string')), 'invalid MCP env');
  } else {
    requireValue(v.transport === 'http' && url(v.url), 'MCP URL must be http or https');
    requireValue(v.headers === undefined || (isObject(v.headers) && Object.entries(v.headers).every(([k, x]) => /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(k) && typeof x === 'string' && !/[\r\n]/.test(x))), 'invalid MCP headers');
  }
}
export function validateConfig(v: unknown): asserts v is Config {
  requireValue(isObject(v) && v.version === 1, 'invalid config version');
  requireValue(isObject(v.active) && string(v.active.provider) && string(v.active.model), 'invalid active provider/model');
  requireValue(Array.isArray(v.providers) && v.providers.length, 'providers are required');
  const ids = new Set<string>();
  for (const p of v.providers) {
    requireValue(isObject(p) && string(p.id) && (p.kind === 'anthropic' || p.kind === 'openai-compatible') && url(p.baseUrl), 'invalid provider');
    requireValue(!ids.has(p.id as string), 'duplicate provider id'); ids.add(p.id as string);
    requireValue(p.label === undefined || typeof p.label === 'string', 'invalid provider label');
    requireValue(p.apiKeyEnv === undefined || envName(p.apiKeyEnv), 'invalid provider apiKeyEnv');
    for (const key of ['maxTokens', 'contextWindow']) requireValue(p[key] === undefined || integer(p[key], 1), `invalid provider ${key}`);
  }
  requireValue(ids.has(v.active.provider as string), 'active provider is missing');
  requireValue(isObject(v.agent) && integer(v.agent.maxTurns, 1) && string(v.agent.workspace) && typeof v.agent.compactAt === 'number' && v.agent.compactAt > 0 && v.agent.compactAt <= 1, 'invalid agent settings');
  requireValue(v.agent.systemPrompt === undefined || typeof v.agent.systemPrompt === 'string', 'invalid system prompt');
  requireValue(isObject(v.permissions) && Object.values(v.permissions).every(x => typeof x === 'string' && ['allow', 'ask', 'deny'].includes(x)), 'invalid permissions');
  requireValue(isObject(v.hooks), 'invalid hooks');
  for (const key of ['preTool', 'postTool', 'sessionEnd']) {
    const hooks = v.hooks[key];
    requireValue(hooks === undefined || (Array.isArray(hooks) && hooks.every(h => isObject(h) && string(h.command) && (h.tools === undefined || strings(h.tools)) && (h.timeoutMs === undefined || integer(h.timeoutMs, 1, 2 ** 31 - 1)))), `invalid ${key} hooks`);
  }
  requireValue(isObject(v.mcp) && isObject(v.mcp.servers), 'invalid MCP servers');
  for (const [name, server] of Object.entries(v.mcp.servers)) { validateMcpName(name); validateMcpServer(server); }
  requireValue(isObject(v.line) && typeof v.line.enabled === 'boolean' && integer(v.line.port, 0, 65535) && integer(v.line.slowResponseMs, 1, 2 ** 31 - 1), 'invalid LINE settings');
  requireValue(v.line.publicUrl === undefined || v.line.publicUrl === '' || url(v.line.publicUrl), 'invalid LINE public URL');
  const allow = v.line.allow;
  requireValue(isObject(allow) && ['users', 'groups', 'rooms'].every(k => strings(allow[k])), 'invalid LINE allowlists');
  requireValue(isObject(v.api) && integer(v.api.port, 0, 65535), 'invalid API port');
}

export function restoreMaskedConfig(input: Config, stored: Config, clean: (text: string) => string): Config {
  const restore = (value: unknown, old: unknown): unknown => {
    if (typeof value === 'string' && typeof old === 'string' && value !== old && value === clean(old)) return old;
    if (Array.isArray(value)) {
      const previous = Array.isArray(old) ? old : [], used = new Set<number>();
      const masked = previous.map(v => JSON.stringify(safeValue(v, clean)));
      return value.map((v, i) => {
        const text = JSON.stringify(v);
        const match = !used.has(i) && masked[i] === text ? i : masked.findIndex((m, j) => m === text && !used.has(j));
        if (match >= 0) used.add(match);
        return restore(v, previous[match >= 0 ? match : i]);
      });
    }
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, restore(v, isObject(old) && Object.hasOwn(old, k) ? old[k] : undefined)]));
    return value;
  };
  const next = restore(input, stored) as Config;
  next.mcp.servers.rea ??= structuredClone(defaultConfig().mcp.servers.rea!);
  for (const [name, server] of Object.entries(next.mcp.servers)) {
    const prev = stored.mcp.servers[name];
    if (!prev || prev.transport !== server.transport) continue;
    const fields = server.transport === 'stdio' ? server.env : server.headers;
    const old = prev.transport === 'stdio' ? prev.env : prev.headers;
    for (const [k, value] of Object.entries(fields ?? {})) {
      if (old && Object.hasOwn(old, k) && value === maskSecret(old[k]!)) fields![k] = old[k]!;
    }
  }
  safeValue(next, value => {
    requireValue(!value.includes('••••'), 'a masked value could not be restored; re-enter it');
    return value;
  });
  return next;
}
export function settingsResponse(config: Config, home: string) {
  const masked = structuredClone(config), env = readEnv(home);
  for (const server of Object.values(masked.mcp.servers)) {
    const fields = server.transport === 'stdio' ? server.env : server.headers;
    for (const [k, value] of Object.entries(fields ?? {})) if (!reference(value)) fields![k] = maskSecret(value);
  }
  const names = new Set([...config.providers.flatMap(p => p.apiKeyEnv ? [p.apiKeyEnv] : []), 'LINE_CHANNEL_ACCESS_TOKEN', 'LINE_CHANNEL_SECRET', ...Object.keys(env)]);
  return { config: masked, secrets: Object.fromEntries([...names].map(name => [name, maskSecret(env[name] ?? '')])) };
}

// Short env values are often flags/usernames; replacing them in prose corrupts saved data.
export function createCleaner(home: string, config: Config, token = '') {
  const values = [...Object.values(readEnv(home)), token, ...Object.values(config.mcp.servers).flatMap(s => Object.values(s.transport === 'stdio' ? s.env ?? {} : s.headers ?? {}).filter(v => !reference(v)))].filter(v => v.length >= 8);
  const secrets = [...new Set(values.flatMap(v => [v, JSON.stringify(v).slice(1, -1)]))];
  return Object.assign((text: string) => redact(text, secrets), { maxSecretLength: secrets.reduce((n, s) => Math.max(n, s.length), 0) });
}
export const safeText = (text: string, home: string, config: Config, token = '') => createCleaner(home, config, token)(text);
export function safeValue<T>(value: T, clean: (s: string) => string): T {
  if (typeof value === 'string') return clean(value) as T;
  if (Array.isArray(value)) return value.map(v => safeValue(v, clean)) as T;
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeValue(v, clean)])) as T;
  return value;
}
