import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { builtinTools } from '../../src/tools/index.ts';
import type { ToolContext } from '../../src/types.ts';
import { testHome } from '../e2e/helpers.ts';

test('all file tools refuse the added credential stores through direct and symlink paths while allowing siblings', async t => {
  const root = testHome(t), home = join(root, '.bignose'); mkdirSync(home);
  const previousHome = process.env.HOME, previousBigNose = process.env.BIGNOSE_HOME;
  process.env.HOME = root; process.env.BIGNOSE_HOME = home;
  t.after(() => {
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    if (previousBigNose === undefined) delete process.env.BIGNOSE_HOME; else process.env.BIGNOSE_HOME = previousBigNose;
  });
  const ctx: ToolContext = { sessionId: 's', origin: { kind: 'cli' }, cwd: root, signal: new AbortController().signal, depth: 0 };
  const tools = builtinTools(home);
  const run = (name: string, path: string) => tools.find(tool => tool.name === name)!.run({ path, content: 'bad', oldText: 'hidden', newText: 'bad', pattern: 'hidden' }, ctx);
  const paths = ['.git-credentials', '.npmrc', '.pypirc', '.kube/config', '.config/gcloud/credentials'];
  for (const [i, path] of paths.entries()) {
    const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'hidden');
    symlinkSync(file, join(root, `alias-${i}`));
    for (const candidate of [path, `alias-${i}`]) for (const tool of ['read_file', 'write_file', 'edit_file', 'list_files', 'search_files']) {
      const result = await run(tool, candidate);
      assert.equal(result.isError, true, `${tool}: ${candidate}`); assert.match(result.content, /protected credential path/);
    }
    assert.equal(readFileSync(file, 'utf8'), 'hidden');
  }
  for (const dir of ['.kube', '.config/gcloud']) {
    for (const tool of ['list_files', 'search_files']) assert.equal((await run(tool, dir)).isError, true);
    assert.equal((await run('write_file', dir + '/new')).isError, true);
    assert.equal(existsSync(join(root, dir, 'new')), false);
  }
  for (const path of ['.git-credentials-old', '.npmrc.example', '.pypirc.example', '.kube-old/config', '.config/gcloud-old/config']) {
    const file = join(root, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, 'allowed');
    assert.equal((await run('read_file', path)).content, 'allowed');
    assert.equal((await run('write_file', path)).isError, undefined);
  }
  const listing = await run('list_files', '.');
  const search = await run('search_files', '.');
  for (const path of paths) assert.equal(listing.content.split('\n').includes(path), false);
  assert.equal(search.content, '', 'root search never reads hidden stores');
});
