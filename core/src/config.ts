// Home dir, config, .env secrets, masking. Node builtins only.
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { Config } from './types.ts';

export const VERSION = '0.1.0';

const NAME_RE = /^[A-Z_][A-Z0-9_]*$/;
const ENV_LINE_RE = /^\s*([A-Z_][A-Z0-9_]*)\s*=(.*)$/;
const TOKEN_RE = /^[0-9a-f]{64}$/;

function ensureHome(home: string): string {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  return home;
}

/** `$BIGNOSE_HOME` or `~/.bignose`; created 0700 when missing. */
export function homeDir(): string {
  return ensureHome(process.env.BIGNOSE_HOME || join(homedir(), '.bignose'));
}

export function paths(home: string = homeDir()) {
  return {
    home,
    config: join(home, 'config.json'),
    env: join(home, '.env'),
    apiToken: join(home, 'api-token'),
    db: join(home, 'bignose.db'),
    skills: join(home, 'skills'),
    daemon: join(home, 'daemon.json'),
    logs: join(home, 'logs'),
  };
}

// temp file + rename: readers never see a half-written file, and the result has exactly `mode`
function writeAtomic(file: string, text: string, mode: number): void {
  const tmp = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, text, { mode });
  renameSync(tmp, file);
}

// ---- config

export function defaultConfig(): Config {
  return {
    version: 1,
    active: { provider: 'anthropic', model: 'claude-sonnet-5-5' },
    providers: [
      { id: 'anthropic', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', apiKeyEnv: 'ANTHROPIC_API_KEY', contextWindow: 200000, maxTokens: 8192 },
      { id: 'openai', kind: 'openai-compatible', baseUrl: 'https://api.openai.com/v1', apiKeyEnv: 'OPENAI_API_KEY', contextWindow: 128000 },
      { id: 'openrouter', kind: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1', apiKeyEnv: 'OPENROUTER_API_KEY', contextWindow: 128000 },
      { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:11434/v1', contextWindow: 32000 },
    ],
    agent: { maxTurns: 30, workspace: homedir(), compactAt: 0.8 },
    permissions: {},
    hooks: {},
    mcp: { servers: { rea: { transport: 'stdio', command: 'npx', args: ['-y', 'rea-agents@6.1.0', 'mcp'], enabled: false } } },
    line: { enabled: false, port: 47822, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } },
    api: { port: 47821 },
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

// objects recurse; arrays and scalars from `over` replace `base`
function merge(base: unknown, over: unknown): unknown {
  if (!isObj(base) || !isObj(over)) return over;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (k === '__proto__') continue;
    out[k] = Object.hasOwn(base, k) ? merge(base[k], v) : v;
  }
  return out;
}

export function loadConfig(home: string = homeDir()): Config {
  const file = paths(home).config;
  const base = defaultConfig();
  if (!existsSync(file)) return base;
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`invalid config ${file}: ${(e as Error).message}`);
  }
  if (!isObj(parsed)) throw new Error(`invalid config ${file}: expected a JSON object`);
  return merge(base, parsed) as Config;
}

// 0600: MCP env/headers may carry literal values even though secrets belong in .env
export function saveConfig(cfg: Config, home: string = homeDir()): void {
  ensureHome(home);
  writeAtomic(paths(home).config, JSON.stringify(cfg, null, 2) + '\n', 0o600);
}

// ---- secrets (.env)

export function readEnv(home: string = homeDir()): Record<string, string> {
  const file = paths(home).env;
  if (!existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = ENV_LINE_RE.exec(line);
    if (!m) continue; // blank, comment or not a NAME=value line
    let v = m[2]!.trim();
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) v = v.slice(1, -1);
    env[m[1]!] = v;
  }
  return env;
}

/** Set (or, with `null`, remove) one `.env` entry; comments and other lines are kept. File ends up 0600. */
export function setSecret(name: string, value: string | null, home: string = homeDir()): void {
  if (!NAME_RE.test(name)) throw new Error(`invalid secret name: ${name}`);
  if (value !== null && /[\r\n]/.test(value)) throw new Error('secret value must not contain a newline');
  ensureHome(home);
  const file = paths(home).env;
  const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
  while (lines.length && lines.at(-1) === '') lines.pop();
  // values that parseEnv would trim or unquote are written double-quoted so they round-trip
  const entry = value === null ? '' : `${name}=${value !== value.trim() || /^["']/.test(value) ? `"${value}"` : value}`;
  const out: string[] = [];
  let done = false;
  for (const l of lines) {
    if (ENV_LINE_RE.exec(l)?.[1] !== name) {
      out.push(l);
    } else if (value !== null && !done) {
      out.push(entry); // replace in place; later duplicates of the name are dropped
      done = true;
    }
  }
  if (value !== null && !done) out.push(entry);
  writeAtomic(file, out.length ? out.join('\n') + '\n' : '', 0o600);
}

export function getApiKey(cfg: Config, providerId: string, home: string = homeDir()): string | undefined {
  const name = cfg.providers.find((p) => p.id === providerId)?.apiKeyEnv;
  return name ? readEnv(home)[name] || undefined : undefined;
}

export function maskSecret(v: string): string {
  if (v === '') return '';
  return v.length < 12 ? '••••' : '••••' + v.slice(-4);
}

/** Replace every occurrence of each secret (length >= 6) with its mask. Longest first, so overlaps mask cleanly. */
export function redact(text: string, secrets: readonly string[]): string {
  let out = text;
  for (const s of [...secrets].filter((s) => s.length >= 6).sort((a, b) => b.length - a.length)) {
    out = out.split(s).join(maskSecret(s));
  }
  return out;
}

/** Per-install API bearer token: 32 random bytes as hex, created once, 0600. */
export function ensureApiToken(home: string = homeDir()): string {
  ensureHome(home);
  const file = paths(home).apiToken;
  const token = randomBytes(32).toString('hex');
  try {
    writeFileSync(file, token, { mode: 0o600, flag: 'wx' });
    return token;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
  }
  const current = readFileSync(file, 'utf8').trim();
  if (TOKEN_RE.test(current)) {
    chmodSync(file, 0o600);
    return current;
  }
  writeAtomic(file, token, 0o600); // empty or damaged file: an empty token must never authenticate
  return token;
}
