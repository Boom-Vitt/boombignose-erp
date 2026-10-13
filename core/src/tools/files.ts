import { lstat, readlink, realpath, readdir } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { homedir } from 'node:os';
import { matchesGlob } from 'node:path';

// Resolve the nearest existing ancestor, including dangling symlinks, before creating files.
async function realPath(path: string, depth = 0): Promise<string> {
  if (depth > 40) throw new Error('Too many symlinks');
  try { return await realpath(path); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    const stat = await lstat(path).catch(err => { if (err.code !== 'ENOENT') throw err; return undefined; });
    if (stat?.isSymbolicLink()) return realPath(resolve(dirname(path), await readlink(path)), depth + 1);
    const parent = dirname(path);
    if (parent === path) throw e;
    return join(await realPath(parent, depth + 1), basename(path));
  }
}

export function fileGuard(home: string): (path: string) => Promise<string> {
  const homes = [resolve(home), homedir(), ...(basename(home) === '.bignose' ? [dirname(resolve(home))] : [])];
  const roots = Promise.all(homes.map(real => realPath(real)));
  const forbidden = (path: string, root: string) => {
    const r = relative(root, path);
    return ['.ssh', '.aws', '.gnupg', '.config/gh'].some(p => r === p || r.startsWith(p + '/'))
      || ['.env', 'api-token', '.netrc', '.docker/config.json', '.claude.json', '.hermes/.env', '.codex/auth.json'].includes(r)
      || /^\.env\.[^/]*$/.test(r) || /^\.claude\/\.credentials[^/]*(\/|$)/.test(r);
  };
  return async path => {
    const lexical = resolve(path), real = await realPath(lexical);
    if ([...homes, ...await roots].some(root => forbidden(lexical, root) || forbidden(real, root))) throw new Error('refused: protected credential path');
    return real;
  };
}

export async function listFiles(root: string, guard: (p: string) => Promise<string>, signal: AbortSignal, glob?: string): Promise<string[]> {
  const files: string[] = [], seen = new Set<string>();
  async function walk(dir: string): Promise<void> {
    signal.throwIfAborted();
    const real = await guard(dir);
    if (seen.has(real)) return;
    seen.add(real);
    for (const entry of (await readdir(real, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      signal.throwIfAborted();
      if (entry.name === '.git' || entry.name === 'node_modules') continue;
      const path = join(dir, entry.name);
      let safe: string;
      try { safe = await guard(path); } catch { continue; }
      const stat = await lstat(safe).catch(() => undefined);
      if (stat?.isDirectory()) await walk(path);
      else if (stat?.isFile() && (!glob || matchesGlob(relative(root, path), glob))) files.push(path);
      if (files.length >= 5000) return;
    }
  }
  const safe = await guard(root);
  if ((await lstat(safe)).isFile()) return [root];
  await walk(root);
  return files;
}
