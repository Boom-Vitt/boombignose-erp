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
  const stores = ['.ssh', '.aws', '.gnupg', '.config/gh', '.env', 'api-token', '.netrc', '.docker/config.json', '.claude.json', '.hermes/.env', '.codex/auth.json'];
  const forbidden = (path: string, root: string) => {
    const r = relative(root, path);
    return ['.ssh', '.aws', '.gnupg', '.config/gh'].some(p => r === p || r.startsWith(p + '/'))
      || ['.env', 'api-token', '.netrc', '.docker/config.json', '.claude.json', '.hermes/.env', '.codex/auth.json'].includes(r)
      || /^\.env\.[^/]*$/.test(r) || /^\.claude\/\.credentials[^/]*(\/|$)/.test(r);
  };
  return async path => {
    const lexical = resolve(path), real = await realPath(lexical);
    const roots = [...new Set([...homes, ...await Promise.all(homes.map(root => realPath(root)))])];
    const refuse = () => { throw new Error('refused: protected credential path'); };
    if (roots.some(root => forbidden(lexical, root) || forbidden(real, root))) refuse();
    const entries = async (dir: string) => readdir(dir, { withFileTypes: true }).catch((e: NodeJS.ErrnoException) => {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return [];
      throw e;
    });
    const seen = new Set<string>();
    const protect = async (entry: string): Promise<void> => {
      const target = await realpath(entry).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return undefined;
        throw e;
      });
      if (!target || seen.has(target)) return;
      if (real === target || real.startsWith(target + '/')) refuse();
      seen.add(target);
      // Credential directories may contain symlinks to stores outside their own real path.
      for (const child of await entries(target)) {
        if (child.isDirectory() || child.isSymbolicLink()) await protect(join(target, child.name));
      }
    };
    for (const root of roots) {
      const protectedPaths = stores.map(p => join(root, p));
      for (const e of await entries(root)) if (/^\.env\./.test(e.name)) protectedPaths.push(join(root, e.name));
      for (const e of await entries(join(root, '.claude'))) if (e.name.startsWith('.credentials')) protectedPaths.push(join(root, '.claude', e.name));
      for (const entry of protectedPaths) await protect(entry);
    }
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
