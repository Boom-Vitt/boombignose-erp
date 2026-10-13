import { accessSync, constants, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { getApiKey, homeDir, loadConfig, readEnv } from '../config.ts';
import { safeText, validateConfig } from './settings.ts';

export function doctor(home = homeDir()): { code: number; lines: string[] } {
  const lines: string[] = [];
  let code = 0;
  const hard = (label: string, fn: () => void) => {
    try { fn(); lines.push(`ok ${label}`); }
    catch { code = 1; lines.push(`fail ${label}`); }
  };
  hard(`node ${process.versions.node}`, () => { if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node 24 is required'); });
  hard('sqlite + FTS5 trigram', () => {
    const db = new DatabaseSync(':memory:');
    try { db.exec("CREATE VIRTUAL TABLE check_fts USING fts5(text, tokenize='trigram')"); } finally { db.close(); }
  });
  hard('home writable', () => {
    accessSync(home, constants.W_OK);
    const file = join(home, `.doctor-${randomUUID()}`);
    writeFileSync(file, '', { flag: 'wx', mode: 0o600 }); unlinkSync(file);
  });
  try {
    const config = loadConfig(home); validateConfig(config); lines.push('ok config');
    const provider = config.providers.find(p => p.id === config.active.provider)!;
    lines.push(provider.apiKeyEnv && !getApiKey(config, provider.id, home) ? `warn active provider key is unset (${provider.apiKeyEnv})` : 'ok active provider');
    if (config.line.enabled) {
      const env = readEnv(home);
      lines.push(env.LINE_CHANNEL_ACCESS_TOKEN && env.LINE_CHANNEL_SECRET ? 'ok LINE credentials' : 'warn LINE token or secret is unset');
      if (!config.line.allow.users.length && !config.line.allow.groups.length && !config.line.allow.rooms.length) lines.push('warn LINE allowlists are empty');
      if (!config.line.publicUrl) lines.push('warn LINE public URL is unset');
    }
    return { code, lines: lines.map(line => safeText(line, home, config)) };
  } catch { return { code: 1, lines: [...lines, 'fail config'] }; }
}
