// Tiny stderr logger. Every line is redacted against the current .env values.
import { format } from 'node:util';
import { readEnv, redact } from './config.ts';

function emit(level: string, args: unknown[]): void {
  // ponytail: re-reads .env on every line; cache by mtime if logging ever gets hot
  const text = redact(format(...args), Object.values(readEnv()));
  process.stderr.write(`${new Date().toISOString()} ${level} ${text}\n`);
}

export const log = {
  info: (...args: unknown[]) => emit('info', args),
  warn: (...args: unknown[]) => emit('warn', args),
  error: (...args: unknown[]) => emit('error', args),
};
