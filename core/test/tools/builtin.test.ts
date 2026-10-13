import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import dns from 'node:dns';
import { once } from 'node:events';
import { builtinTools } from '../../src/tools/index.ts';
import type { ToolContext } from '../../src/types.ts';

function setup(t: { after(fn: () => void): void }) {
  const dir = mkdtempSync(tmpdir() + '/bn-');
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const ctx: ToolContext = { sessionId: 's', origin: { kind: 'cli' }, cwd: dir, signal: new AbortController().signal, depth: 0 };
  const tools = builtinTools(dir);
  const run = (name: string, input: Record<string, unknown>, context = ctx) => tools.find(t => t.name === name)!.run(input, context);
  return { dir, ctx, tools, run };
}

test('file tools read slices, create directories and enforce exact unique edits', async t => {
  const { dir, run } = setup(t);
  assert.equal((await run('write_file', { path: 'sub/a.txt', content: 'one\ntwo\nthree' })).isError, undefined);
  assert.equal((await run('read_file', { path: 'sub/a.txt', offset: 1, limit: 2 })).content, 'two\nthree');
  assert.equal((await run('edit_file', { path: 'sub/a.txt', oldText: 'two', newText: 'changed' })).isError, undefined);
  assert.equal(readFileSync(dir + '/sub/a.txt', 'utf8'), 'one\nchanged\nthree');
  await run('write_file', { path: 'repeat', content: 'x x' });
  assert.equal((await run('edit_file', { path: 'repeat', oldText: 'x', newText: 'y' })).isError, true);
  assert.equal((await run('edit_file', { path: 'repeat', oldText: '', newText: 'y' })).isError, true);
  assert.equal((await run('edit_file', { path: 'repeat', oldText: 'absent', newText: 'y' })).isError, true);
  await run('edit_file', { path: 'repeat', oldText: 'x', newText: 'y', replaceAll: true });
  assert.equal(readFileSync(dir + '/repeat', 'utf8'), 'y y');
});

test('list globs and regex search skip dependency and git trees', async t => {
  const { dir, run } = setup(t);
  for (const p of ['notes.txt', 'sub/a.txt', '.git/hidden.txt', 'node_modules/hidden.txt', 'other.md']) {
    mkdirSync(dir + '/' + p.slice(0, p.lastIndexOf('/') + 1), { recursive: true });
    writeFileSync(dir + '/' + p, 'first\nhello world\n');
  }
  assert.equal((await run('list_files', { glob: '**/*.txt' })).content, 'notes.txt\nsub/a.txt');
  assert.equal((await run('search_files', { pattern: 'hello w.rld', glob: '*.txt' })).content, 'notes.txt:2: hello world');
  assert.equal((await run('search_files', { pattern: '[' })).isError, true);
});

test('credential stores are refused through direct, dot-dot and symlink paths, including new files', async t => {
  const { dir, run } = setup(t);
  const sensitive = ['.env', '.env.local', 'api-token', '.ssh/id_x', '.aws/credentials', '.gnupg/private', '.config/gh/hosts.yml', '.netrc', '.docker/config.json', '.claude.json', '.claude/.credentials.json', '.hermes/.env', '.codex/auth.json'];
  mkdirSync(dir + '/work');
  for (const [i, path] of sensitive.entries()) {
    mkdirSync(dir + '/' + path.slice(0, path.lastIndexOf('/') + 1), { recursive: true });
    writeFileSync(dir + '/' + path, 'hidden-marker');
    symlinkSync(dir + '/' + path, dir + '/alias' + i);
    for (const name of ['read_file', 'write_file', 'edit_file']) {
      for (const candidate of [path, 'work/../' + path, 'alias' + i]) {
        const r = await run(name, { path: candidate, content: 'bad', oldText: 'hidden', newText: 'bad' });
        assert.equal(r.isError, true, name + ':' + candidate); assert.match(r.content, /protected/);
      }
    }
  }
  symlinkSync(dir + '/.ssh/new', dir + '/dangling');
  assert.equal((await run('write_file', { path: 'dangling', content: 'bad' })).isError, true);
  assert.equal(existsSync(dir + '/.ssh/new'), false);
  assert.equal((await run('list_files', {})).content, '');
  assert.equal((await run('search_files', { pattern: 'hidden-marker' })).content, '');
  assert.equal((await run('list_files', { path: '.ssh' })).isError, true);
});

test('shell captures output, caps output and terminates on timeout and abort', async t => {
  const { run, ctx, dir, tools } = setup(t);
  assert.equal(tools.find(t => t.name === 'shell')?.defaultPolicy, 'ask');
  assert.equal((await run('shell', { command: 'printf hello; printf error >&2' })).content, 'helloerror');
  const capped = await run('shell', { command: 'yes x | head -c 150000' }); assert.ok(capped.content.length <= 100_000);
  assert.match((await run('shell', { command: 'sleep 30', timeoutMs: 25 })).content, /timeout/);
  const controller = new AbortController();
  const promise = run('shell', { command: `sleep 0.3; printf survived > '${dir}/survived'` }, { ...ctx, signal: controller.signal });
  setTimeout(() => controller.abort(), 25);
  assert.match((await promise).content, /interrupted/);
  await new Promise(r => setTimeout(r, 350)); assert.equal(existsSync(dir + '/survived'), false);
});

test('delegate forwards to its separate context runner and errors when unavailable', async t => {
  const { run, ctx } = setup(t);
  assert.equal((await run('delegate', { task: 'help' }, { ...ctx, delegate: async s => 'answer to ' + s })).content, 'answer to help');
  assert.equal((await run('delegate', { task: 'help' })).isError, true);
});

test('web_fetch defaults to ask and rejects private and mapped addresses without connecting', async t => {
  const { run, tools } = setup(t);
  assert.equal(tools.find(t => t.name === 'web_fetch')?.defaultPolicy, 'ask');
  for (const host of ['127.0.0.1', 'localhost', '10.1.2.3', '192.168.1.1', '169.254.1.1', '172.16.1.1', '0.0.0.0', '[::1]', '[::]', '[fc00::1]', '[fe80::1]', '[::ffff:127.0.0.1]', '[::ffff:7f00:1]']) {
    const r = await run('web_fetch', { url: `http://${host}/` });
    assert.equal(r.isError, true, host); assert.match(r.content, /private/);
  }
  assert.equal((await run('web_fetch', { url: 'file:///etc/passwd' })).isError, true);
});

test('web_fetch rechecks redirect hops and rejects rebinding at connection lookup', async t => {
  const { run } = setup(t);
  const server = http.createServer((req, res) => { res.writeHead(302, { Location: 'http://10.1.2.3/private' }); res.end(); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  t.after(() => server.close());
  // Only the transport is routed to a local fixture; production still checks each URL's host.
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const original = http.request;
  t.mock.method(http, 'request', (_url: unknown, options: any, callback: any) => original(`http://127.0.0.1:${port}/`, { ...options, lookup: undefined }, callback));
  assert.match((await run('web_fetch', { url: 'http://public.test/' })).content, /private/);
  t.mock.restoreAll();
  let looked = 0;
  t.mock.method(dns.promises, 'lookup', async () => [{ address: ++looked === 1 ? '93.184.216.34' : '127.0.0.1', family: 4 }]);
  const r = await run('web_fetch', { url: 'http://public.test/' });
  assert.equal(r.isError, true); assert.match(r.content, /private/); assert.equal(looked, 2);
});

test('web_fetch extracts HTML text, caps response bodies and honours abort without internet', async t => {
  const { run, ctx } = setup(t);
  const server = http.createServer((req, res) => {
    if (req.url === '/large') { res.end('x'.repeat(2_000_001)); return; }
    if (req.url === '/slow') return;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<style>hidden</style><h1>Hello &amp; world</h1><script>hidden</script>');
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = (server.address() as { port: number }).port;
  t.after(() => { server.closeAllConnections(); server.close(); });
  t.mock.method(dns.promises, 'lookup', async () => [{ address: '93.184.216.34', family: 4 }]);
  const original = http.request;
  t.mock.method(http, 'request', (url: URL, options: any, callback: any) => original(`http://127.0.0.1:${port}${url.pathname}`, { ...options, lookup: undefined }, callback));
  assert.equal((await run('web_fetch', { url: 'http://public.test/' })).content, 'Hello & world');
  assert.match((await run('web_fetch', { url: 'http://public.test/large' })).content, /2 MB/);
  const controller = new AbortController();
  const pending = run('web_fetch', { url: 'http://public.test/slow' }, { ...ctx, signal: controller.signal });
  setTimeout(() => controller.abort(), 20);
  assert.equal((await pending).content, 'interrupted');
});
