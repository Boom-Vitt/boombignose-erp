import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../../src/store/index.ts';
import { memoryPrompt, memoryTools, sessionSearchTool } from '../../src/memory/tools.ts';
import type { Tool, ToolContext } from '../../src/types.ts';

const ctx: ToolContext = { sessionId: 's', origin: { kind: 'desktop' }, cwd: '/', signal: new AbortController().signal, depth: 0 };

function setup(t: { after(fn: () => void): void }) {
  const store = openStore(':memory:');
  t.after(() => store.close());
  const [read, write] = memoryTools(store) as [Tool, Tool];
  return { store, read, write, search: sessionSearchTool(store) };
}

test('tool specs: names, policies, schemas', (t) => {
  const { read, write, search } = setup(t);
  assert.deepEqual([read.name, write.name, search.name], ['memory_read', 'memory_write', 'session_search']);
  for (const tool of [read, write, search]) {
    assert.equal(tool.defaultPolicy, 'allow');
    assert.match(tool.name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(tool.inputSchema.type, 'object');
  }
});

test('memory_write add/update/delete and memory_read list/search', async (t) => {
  const { store, read, write } = setup(t);
  assert.equal((await read.run({}, ctx)).content, 'No notes.');

  const added = await write.run({ action: 'add', kind: 'user', text: 'ชอบกาแฟดำ' }, ctx);
  assert.equal(added.isError, undefined);
  const id = store.listMemory()[0]!.id;
  assert.equal(added.content, `Added note ${id}.`);
  await write.run({ action: 'add', kind: 'agent', text: 'Use pnpm, not npm' }, ctx);

  const all = (await read.run({}, ctx)).content;
  assert.match(all, new RegExp(`\\[${id}\\] \\(user\\) ชอบกาแฟดำ`));
  assert.match(all, /\(agent\) Use pnpm/);
  assert.doesNotMatch((await read.run({ kind: 'agent' }, ctx)).content, /กาแฟ/);
  assert.match((await read.run({ query: 'กาแฟ' }, ctx)).content, /ชอบกาแฟดำ/);
  assert.equal((await read.run({ query: 'กาแฟ', kind: 'agent' }, ctx)).content, 'No matching notes.');
  assert.match((await read.run({ query: 'PNPM' }, ctx)).content, /Use pnpm/);

  assert.equal((await write.run({ action: 'update', id, text: 'ชอบชา' }, ctx)).content, `Updated note ${id}.`);
  assert.equal(store.listMemory('user')[0]!.text, 'ชอบชา');
  assert.equal((await write.run({ action: 'delete', id }, ctx)).content, `Deleted note ${id}.`);
  assert.equal(store.listMemory('user').length, 0);
});

test('memory_write and memory_read reject bad input without throwing', async (t) => {
  const { store, read, write } = setup(t);
  const bad = [
    { action: 'add', text: 'x' },                       // no kind
    { action: 'add', kind: 'other', text: 'x' },
    { action: 'add', kind: 'user', text: '   ' },
    { action: 'add', kind: 'user', text: 'x'.repeat(2001) },
    { action: 'update', text: 'x' },                    // no id
    { action: 'update', id: 999, text: 'x' },           // unknown id
    { action: 'delete', id: 'abc' },
    { action: 'delete', id: 999 },
    { action: 'explode' },
    {},
  ];
  for (const input of bad) assert.equal((await write.run(input, ctx)).isError, true, JSON.stringify(input));
  assert.equal(store.listMemory().length, 0);
  assert.equal((await read.run({ kind: 'other' }, ctx)).isError, true);
});

test('session_search finds past conversations in Thai and English', async (t) => {
  const { store, search } = setup(t);
  const a = store.createSession({ title: 'แผนเที่ยว', origin: { kind: 'desktop' } });
  store.appendMessages(a.id, [{ role: 'user', content: [{ type: 'text', text: 'อยากไปเที่ยวเชียงใหม่ช่วงปีใหม่' }] }]);
  const b = store.createSession({ title: 'ops', origin: { kind: 'cli' } });
  store.appendMessages(b.id, [{ role: 'user', content: [{ type: 'text', text: 'restart the nginx container' }] }]);

  const th = await search.run({ query: 'เชียงใหม่' }, ctx);
  assert.match(th.content, new RegExp(`session ${a.id} "แผนเที่ยว"`));
  assert.match(th.content, /เชียงใหม่/);
  assert.match((await search.run({ query: 'NGINX' }, ctx)).content, new RegExp(`session ${b.id}`));
  assert.equal((await search.run({ query: 'nothing here' }, ctx)).content, 'No matching conversations.');
  assert.equal((await search.run({ query: '  ' }, ctx)).isError, true);
  assert.equal((await search.run({}, ctx)).isError, true);
});

test('memoryPrompt: empty, grouped by kind, multi-line notes flattened', (t) => {
  const { store } = setup(t);
  assert.equal(memoryPrompt(store), '');
  store.addMemory('user', 'ชื่อบูม');
  store.addMemory('agent', 'line one\nline two');
  const p = memoryPrompt(store);
  assert.match(p, /^# Memory/);
  assert.match(p, /About the user:\n- ชื่อบูม/);
  assert.match(p, /Your own notes:\n- line one line two/);
});

test('memoryPrompt is capped at 4000 chars and keeps the newest notes', (t) => {
  const { store } = setup(t);
  for (let i = 0; i < 60; i++) store.addMemory('agent', `note-${String(i).padStart(2, '0')} ${'x'.repeat(150)}`);
  const p = memoryPrompt(store);
  assert.ok(p.length <= 4000, `length ${p.length}`);
  assert.match(p, /note-59/);
  assert.doesNotMatch(p, /note-00/);
  assert.match(p, /older notes omitted/);
  assert.ok(p.indexOf('note-58') < p.indexOf('note-59'), 'oldest kept note first');
});

test('memoryPrompt copes with one oversized note added outside the tool', (t) => {
  const { store } = setup(t);
  store.addMemory('user', 'y'.repeat(10000));
  const p = memoryPrompt(store);
  assert.ok(p.length > 0 && p.length <= 4000);
});
