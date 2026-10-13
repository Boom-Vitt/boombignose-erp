// Tiny stderr logger. Every line is redacted against the current .env values and the API token.
import { existsSync, readFileSync } from 'node:fs';
import { format, inspect } from 'node:util';
import { homeDir, paths, readEnv, redact } from './config.ts';

// Each secret plus the forms it takes when escaped by util.inspect (objects, errors) or JSON.stringify.
function secretsToRedact(): string[] {
  const home = homeDir();
  const values = Object.values(readEnv(home));
  const tokenFile = paths(home).apiToken;
  if (existsSync(tokenFile)) values.push(readFileSync(tokenFile, 'utf8').trim());
  const forms = new Set<string>();
  for (const v of values) {
    if (v === '') continue;
    for (const f of [v, inspect(v).slice(1, -1), JSON.stringify(v).slice(1, -1)]) forms.add(f);
  }
  return [...forms];
}

function emit(level: string, args: unknown[]): void {
  // ponytail: re-reads .env on every line; cache by mtime if logging ever gets hot
  const text = redact(format(...args), secretsToRedact());
  process.stderr.write(`${new Date().toISOString()} ${level} ${text}\n`);
}

export const log = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
