import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openStore } from '../../src/store/index.ts';
import type { Message } from '../../src/types.ts';

function tmpStore(t: { after(fn: () => void): void }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  const file = path.join(dir, 'bignose.db');
  const store = openStore(file);
  t.after(() => { try { store.close(); } catch { /* already closed */ } fs.rmSync(dir, { recursive: true, force: true }); });
  return { store, file, dir };
}

const user = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });
const assistant = (text: string): Message => ({ role: 'assistant', content: [{ type: 'text', text }] });

test('schema is idempotent and uses WAL', (t) => {
  const { store, file } = tmpStore(t);
  const s = store.createSession({ title: 'a', origin: { kind: 'desktop' } });
  store.close();
  const again = openStore(file); // reopening re-runs the schema
  t.after(() => again.close());
  assert.equal(again.getSession(s.id)?.title, 'a');
  assert.ok(fs.existsSync(`${file}-wal`) || fs.existsSync(file));
});

test('sessions: create, list newest first, title, delete', (t) => {
  const { store } = tmpStore(t);
  const a = store.createSession({ title: 'first', origin: { kind: 'desktop' } });
  const b = store.createSession({ origin: { kind: 'cli' } });
  assert.equal(store.getSession(b.id)?.title, '');
  store.setTitle(b.id, 'second');
  assert.deepEqual(store.listSessions().map((s) => s.id), [b.id, a.id]);
  assert.equal(store.listSessions({ limit: 1 }).length, 1);
  assert.equal(store.getSession('nope'), undefined);
  assert.equal(store.deleteSession(a.id), true);
  assert.equal(store.deleteSession(a.id), false);
  assert.deepEqual(store.listSessions().map((s) => s.id), [b.id]);
});

test('findSessionByOrigin matches the exact origin and returns the latest', async (t) => {
  const { store } = tmpStore(t);
  const one = store.createSession({ origin: { kind: 'line', to: 'Cabc' } });
  store.createSession({ origin: { kind: 'line', to: 'Cother' } });
  const two = store.createSession({ origin: { kind: 'line', to: 'Cabc' } });
  assert.equal(store.findSessionByOrigin({ kind: 'line', to: 'Cabc' })?.id, two.id);
  await new Promise((r) => setTimeout(r, 5)); // distinct millisecond
  store.appendMessages(one.id, [user('bump')]); // most recently updated wins
  assert.equal(store.findSessionByOrigin({ kind: 'line', to: 'Cabc' })?.id, one.id);
  assert.equal(store.findSessionByOrigin({ kind: 'line', to: 'Cnone' }), undefined);
  assert.equal(store.findSessionByOrigin({ kind: 'desktop' }), undefined);
  assert.deepEqual(store.getSession(one.id)?.origin, { kind: 'line', to: 'Cabc' });
});

test('transcript and model context round trip separately', (t) => {
  const { store } = tmpStore(t);
  const s = store.createSession({ origin: { kind: 'desktop' } });
  const msgs: Message[] = [
    user('hi'),
    { role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool_use', id: 't1', name: 'shell', input: { cmd: 'ls' } }] },
    { role: 'user', content: [{ type: 'tool_result', toolUseId: 't1', content: 'a.txt', isError: false }] },
  ];
  store.appendMessages(s.id, msgs);
  store.appendMessages(s.id, [assistant('done')]);
  assert.deepEqual(store.getMessages(s.id), [...msgs, assistant('done')]);
  assert.deepEqual(store.getSession(s.id)?.context, []);
  const ctx = [user('[Summary of earlier conversation]\nx'), assistant('done')];
  store.setContext(s.id, ctx);
  assert.deepEqual(store.getSession(s.id)?.context, ctx);
  assert.equal(store.getMessages(s.id).length, 4, 'compacted context does not touch the transcript');
});

test('searchMessages: Thai and English substrings, snippet, one hit per session', (t) => {
  const { store } = tmpStore(t);
  const a = store.createSession({ title: 'ภาษาไทย', origin: { kind: 'desktop' } });
  const b = store.createSession({ title: 'English', origin: { kind: 'cli' } });
  store.appendMessages(a.id, [user('วันนี้อากาศดีมาก อยากไปกินข้าวที่เชียงใหม่'), assistant('เชียงใหม่ เป็นเมืองที่น่าไปจริงๆ')]);
  store.appendMessages(b.id, [user('Deploy the Kubernetes cluster tomorrow'), assistant('Kubernetes is ready')]);

  const th = store.searchMessages('เชียงใหม่');
  assert.equal(th.length, 1, 'one hit per session');
  assert.equal(th[0]!.sessionId, a.id);
  assert.equal(th[0]!.title, 'ภาษาไทย');
  assert.match(th[0]!.snippet, /เชียงใหม่/);
  assert.equal(typeof th[0]!.at, 'number');
  assert.equal(store.searchMessages('อากาศ')[0]!.sessionId, a.id, 'substring inside a Thai sentence');

  const en = store.searchMessages('kubernetes'); // case-insensitive
  assert.equal(en[0]!.sessionId, b.id);
  assert.match(en[0]!.snippet, /Kubernetes/);
  assert.equal(store.searchMessages('netes cl')[0]!.sessionId, b.id, 'substring across a space');
  assert.deepEqual(store.searchMessages('does-not-exist'), []);
  assert.deepEqual(store.searchMessages('   '), []);
  assert.equal(store.searchMessages('the', 1).length, 1);
});

test('searchMessages ranks the better match first', (t) => {
  const { store } = tmpStore(t);
  const weak = store.createSession({ title: 'weak', origin: { kind: 'desktop' } });
  const strong = store.createSession({ title: 'strong', origin: { kind: 'desktop' } });
  store.appendMessages(weak.id, [user(`${'filler words '.repeat(40)} invoice ${'more filler '.repeat(40)}`)]);
  store.appendMessages(strong.id, [user('invoice invoice invoice')]);
  assert.deepEqual(store.searchMessages('invoice').map((h) => h.title), ['strong', 'weak']);
});

test('searchMessages limits sessions after grouping, even with 600 hits in one chat', async (t) => {
  const { store } = tmpStore(t);
  const other = store.createSession({ title: 'other', origin: { kind: 'desktop' } });
  const chat = store.createSession({ title: 'long chat', origin: { kind: 'line', to: 'Cchat' } });
  store.appendMessages(other.id, [user(`${'filler '.repeat(40)} needle`)]);
  await new Promise((resolve) => setTimeout(resolve, 5));
  store.appendMessages(chat.id, Array.from({ length: 600 }, () => user('needle needle needle')));
  for (const query of ['needle', 'ne']) { // FTS and short-query LIKE
    const hits = store.searchMessages(query, 2);
    assert.deepEqual(new Set(hits.map((h) => h.sessionId)), new Set([chat.id, other.id]), query);
    assert.equal(store.searchMessages(query, 1).length, 1);
  }
});

test('queries with FTS syntax characters are safe', (t) => {
  const { store } = tmpStore(t);
  const s = store.createSession({ origin: { kind: 'desktop' } });
  store.appendMessages(s.id, [user('say "hello" to foo-bar OR baz* and NEAR(a b)')]);
  for (const q of ['"hello"', 'foo-bar', 'OR baz', 'baz*', 'NEAR(a b)', '"', 'a" OR "b', '(', 'AND NOT', '^x', 'col:val', '*']) {
    assert.doesNotThrow(() => store.searchMessages(q), q);
    assert.doesNotThrow(() => store.searchMemory(q), q);
  }
  assert.equal(store.searchMessages('"hello"').length, 1, 'quotes match literally');
  assert.equal(store.searchMessages('foo-bar').length, 1);
  assert.equal(store.searchMessages('OR baz*').length, 1, 'OR and * are plain text');
  assert.equal(store.searchMessages('hello OR nothing').length, 0, 'OR is not an operator');
});

test('short queries (< 3 characters) fall back to LIKE, with wildcards escaped', (t) => {
  const { store } = tmpStore(t);
  const s = store.createSession({ origin: { kind: 'desktop' } });
  store.appendMessages(s.id, [user('ไป กิน ข้าว'), user('100% sure'), user('a_b')]);
  assert.equal(store.searchMessages('ไป').length, 1);
  assert.equal(store.searchMessages('%').length, 1, '% is literal');
  assert.equal(store.searchMessages('_').length, 1, '_ is literal');
  assert.match(store.searchMessages('ไป')[0]!.snippet, /ไป/);
  store.addMemory('user', 'ชอบกาแฟ');
  assert.equal(store.searchMemory('กา').length, 1);
  assert.equal(store.searchMemory('zz').length, 0);
});

test('deleting a session cascades to messages and the search index', (t) => {
  const { store } = tmpStore(t);
  const s = store.createSession({ origin: { kind: 'desktop' } });
  store.appendMessages(s.id, [user('unique-needle-text')]);
  assert.equal(store.searchMessages('needle').length, 1);
  store.deleteSession(s.id);
  assert.deepEqual(store.getMessages(s.id), []);
  assert.deepEqual(store.searchMessages('needle'), []);
  assert.deepEqual(store.searchMessages('ne'), []);
});

test('tool-only messages are stored but not indexed', (t) => {
  const { store } = tmpStore(t);
  const s = store.createSession({ origin: { kind: 'desktop' } });
  store.appendMessages(s.id, [{ role: 'user', content: [{ type: 'tool_result', toolUseId: 'x', content: 'secretish-output' }] }]);
  assert.equal(store.getMessages(s.id).length, 1);
  assert.deepEqual(store.searchMessages('secretish'), []);
});

test('memory: add, list by kind, update, delete, search stays in sync', (t) => {
  const { store } = tmpStore(t);
  const u = store.addMemory('user', 'ชอบดื่มกาแฟดำ ไม่ใส่น้ำตาล');
  const a = store.addMemory('agent', 'The repo uses pnpm workspaces');
  assert.deepEqual(store.listMemory().map((n) => n.id), [u.id, a.id]);
  assert.deepEqual(store.listMemory('user').map((n) => n.id), [u.id]);
  assert.deepEqual(store.listMemory('agent').map((n) => n.text), ['The repo uses pnpm workspaces']);

  const hit = store.searchMemory('กาแฟ');
  assert.equal(hit.length, 1);
  assert.equal(hit[0]!.id, u.id);
  assert.match(hit[0]!.snippet, /กาแฟ/);
  assert.equal(store.searchMemory('PNPM')[0]!.kind, 'agent');
  assert.equal(store.searchMemory('pnpm', 20, 'user').length, 0, 'kind filter');

  assert.equal(store.updateMemory(u.id, 'ชอบชาเขียว')?.text, 'ชอบชาเขียว');
  assert.equal(store.searchMemory('กาแฟ').length, 0, 'old text leaves the index');
  assert.equal(store.searchMemory('ชาเขียว').length, 1);
  assert.equal(store.updateMemory(9999, 'x'), undefined);

  assert.equal(store.deleteMemory(a.id), true);
  assert.equal(store.deleteMemory(a.id), false);
  assert.equal(store.searchMemory('pnpm').length, 0);
  assert.throws(() => store.addMemory('other' as 'user', 'x'));
});

test('jobs: save, upsert in place, list in order, delete, survive reopen', (t) => {
  const { store, file } = tmpStore(t);
  const j1 = { id: 'j1', cron: '0 9 * * *', prompt: 'brief me', delivery: { kind: 'desktop' as const }, enabled: true };
  const j2 = { id: 'j2', cron: '*/5 * * * *', prompt: 'ping', delivery: { kind: 'line' as const, to: 'Cabc' }, enabled: false };
  store.saveJob(j1);
  store.saveJob(j2);
  store.saveJob({ ...j1, lastRunAt: 123, lastStatus: 'ok' });
  assert.deepEqual(store.listJobs(), [{ ...j1, lastRunAt: 123, lastStatus: 'ok' }, j2]);
  store.close();
  const again = openStore(file);
  t.after(() => again.close());
  assert.equal(again.listJobs().length, 2);
  assert.equal(again.deleteJob('j1'), true);
  assert.equal(again.deleteJob('j1'), false);
  assert.deepEqual(again.listJobs().map((j) => j.id), ['j2']);
});
