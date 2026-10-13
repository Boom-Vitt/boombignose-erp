import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import type { JsonSchema, Policy, Tool } from '../types.ts';
import { fileGuard, listFiles } from './files.ts';
import { runCommand } from './process.ts';
import { fetchWeb } from './web.ts';

function string(input: Record<string, unknown>, field: string): string {
  if (typeof input[field] !== 'string') throw new Error(`${field} must be a string`);
  return input[field];
}
function integer(input: Record<string, unknown>, field: string, fallback: number, min: number): number {
  const v = input[field] ?? fallback;
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < min) throw new Error(`${field} must be an integer >= ${min}`);
  return v;
}

export function builtinTools(home: string): Tool[] {
  const guard = fileGuard(home);
  const make = (name: string, description: string, defaultPolicy: Policy, properties: Record<string, JsonSchema>, required: string[], run: Tool['run']): Tool => ({
    name, description, defaultPolicy, inputSchema: { type: 'object', properties, required },
    async run(input, ctx) {
      try { ctx.signal.throwIfAborted(); return await run(input, ctx); }
      catch (e) { return { content: ctx.signal.aborted ? 'interrupted' : e instanceof Error ? e.message : String(e), isError: true }; }
    },
  });
  const pathSchema = { type: 'string', description: 'Path relative to the working directory, or absolute' };
  const path = (i: Record<string, unknown>, cwd: string) => guard(resolve(cwd, string(i, 'path')));
  return [
    make('shell', 'Run a shell command in the working directory', 'ask', { command: { type: 'string' }, timeoutMs: { type: 'integer' } }, ['command'], async (i, ctx) => {
      const r = await runCommand(string(i, 'command'), { cwd: ctx.cwd, signal: ctx.signal, timeoutMs: integer(i, 'timeoutMs', 120_000, 1) });
      const output = r.stdout + r.stderr;
      return r.code === 0 && !r.reason ? { content: output } : { content: `${output}\n${r.reason ?? `exit ${r.code}`}`.slice(0, 100_000), isError: true };
    }),
    make('read_file', 'Read lines of a file (zero-based offset)', 'allow', { path: pathSchema, offset: { type: 'integer' }, limit: { type: 'integer' } }, ['path'], async (i, ctx) => {
      const offset = integer(i, 'offset', 0, 0), limit = integer(i, 'limit', 2000, 0);
      return { content: (await readFile(await path(i, ctx.cwd), 'utf8')).split(/\r?\n/).slice(offset, offset + limit).join('\n').slice(0, 100_000) };
    }),
    make('write_file', 'Write a file, creating parent directories', 'ask', { path: pathSchema, content: { type: 'string' } }, ['path', 'content'], async (i, ctx) => {
      const p = await path(i, ctx.cwd), content = string(i, 'content');
      await mkdir(dirname(p), { recursive: true }); ctx.signal.throwIfAborted(); await writeFile(p, content, { signal: ctx.signal });
      return { content: 'written' };
    }),
    make('edit_file', 'Replace an exact unique match, or all matches when replaceAll is true', 'ask', { path: pathSchema, oldText: { type: 'string' }, newText: { type: 'string' }, replaceAll: { type: 'boolean' } }, ['path', 'oldText', 'newText'], async (i, ctx) => {
      const p = await path(i, ctx.cwd), old = string(i, 'oldText'), replacement = string(i, 'newText');
      if (!old) throw new Error('oldText must not be empty');
      if (i.replaceAll !== undefined && typeof i.replaceAll !== 'boolean') throw new Error('replaceAll must be boolean');
      const text = await readFile(p, 'utf8'), count = text.split(old).length - 1;
      if (!count || count !== 1 && !i.replaceAll) throw new Error('oldText must match exactly once unless replaceAll is true');
      await writeFile(p, i.replaceAll ? text.split(old).join(replacement) : text.replace(old, () => replacement), { signal: ctx.signal });
      return { content: 'edited' };
    }),
    make('list_files', 'List files, skipping credential stores, .git and node_modules', 'allow', { path: pathSchema, glob: { type: 'string' } }, [], async (i, ctx) => {
      const root = resolve(ctx.cwd, i.path === undefined ? '.' : string(i, 'path'));
      const files = await listFiles(root, guard, ctx.signal, i.glob === undefined ? undefined : string(i, 'glob'));
      return { content: files.map(p => relative(ctx.cwd, p)).join('\n').slice(0, 100_000) };
    }),
    make('search_files', 'Search file lines by regular expression; returns path:line: text', 'allow', { path: pathSchema, pattern: { type: 'string' }, glob: { type: 'string' } }, ['pattern'], async (i, ctx) => {
      const regex = new RegExp(string(i, 'pattern')), root = resolve(ctx.cwd, i.path === undefined ? '.' : string(i, 'path'));
      const output: string[] = []; let size = 0;
      for (const p of await listFiles(root, guard, ctx.signal, i.glob === undefined ? undefined : string(i, 'glob'))) {
        ctx.signal.throwIfAborted();
        const bytes = await readFile(await guard(p));
        if (bytes.includes(0)) continue;
        for (const [index, line] of bytes.toString('utf8').split(/\r?\n/).entries()) {
          if (regex.test(line)) { const item = `${relative(ctx.cwd, p)}:${index + 1}: ${line}`; output.push(item); size += item.length + 1; }
          if (output.length >= 1000 || size >= 100_000) return { content: output.join('\n').slice(0, 100_000) };
        }
      }
      return { content: output.join('\n') };
    }),
    make('web_fetch', 'Fetch a public http/https URL as text', 'ask', { url: { type: 'string' } }, ['url'], async (i, ctx) => ({ content: await fetchWeb(string(i, 'url'), ctx.signal) })),
    make('delegate', 'Run a task with a subagent in a fresh context', 'allow', { task: { type: 'string' } }, ['task'], async (i, ctx) => {
      if (!ctx.delegate) throw new Error('Delegation is unavailable at this depth');
      return { content: await ctx.delegate(string(i, 'task')) };
    }),
  ];
}
