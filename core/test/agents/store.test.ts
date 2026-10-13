import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openStore } from '../../src/store/index.ts';
import type { Message } from '../../src/types.ts';
import { testHome } from '../e2e/helpers.ts';

const defaults = { provider: 'mock', model: 'first-model', instructions: 'Be helpful.' };
const message = (text: string): Message => ({ role: 'user', content: [{ type: 'text', text }] });

test('agent CRUD, deterministic first agent, defaults created once and persistence', t => {
  const file = join(testHome(t), 'store.db');
  const store = openStore(file);
  t.after(() => { try { store.close(); } catch { /* closed for the restart */ } });
  assert.deepEqual(store.listAgents(), []);
  const first = store.ensureDefaultAgent(defaults);
  assert.match(first.id, /^ag_[a-f0-9]{12}$/);
  assert.equal(first.name, 'BigNose'); assert.equal(first.icon, '🤖');
  assert.equal(first.instructions, defaults.instructions);
  assert.deepEqual(first.permissions, {}); assert.equal(first.connectors, null); assert.equal(first.skills, null);
  assert.ok(first.createdAt > 1e12); assert.equal(first.updatedAt, first.createdAt);
  assert.deepEqual(store.ensureDefaultAgent({ provider: 'other', model: 'other' }), first);
  const second = store.createAgent({ name: '  Research  ', provider: 'other', model: 'local' });
  const patch = { icon: '🔎', instructions: 'Find evidence.', permissions: { shell: 'deny' as const }, connectors: ['rea'], skills: [] };
  const changed = store.updateAgent(second.id, patch)!;
  assert.equal(changed.name, 'Research'); assert.deepEqual(changed.permissions, patch.permissions);
  assert.deepEqual(changed.connectors, ['rea']); assert.deepEqual(changed.skills, []);
  assert.equal(store.getAgent('missing'), undefined); assert.equal(store.updateAgent('missing', {}), undefined);
  assert.equal(store.deleteAgent('missing'), false);
  store.close();
  const db = new DatabaseSync(file);
  // Ties use id, not insertion order or whichever row SQLite happens to return.
  db.prepare('UPDATE agents SET created_at = ?').run(first.createdAt);
  db.close();
  const again = openStore(file); t.after(() => again.close());
  assert.deepEqual(again.getAgent(second.id), { ...changed, createdAt: first.createdAt });
  assert.deepEqual(again.listAgents().map(a => a.id), [first.id, second.id].sort());
  assert.equal(again.ensureDefaultAgent(defaults).id, [first.id, second.id].sort()[0]);
  assert.equal(again.deleteAgent(second.id), true);
  assert.throws(() => again.deleteAgent(first.id), /last agent/);
});

test('scoped sessions, origins, memory and both FTS/short searches; cascades leave shared notes and other agents', t => {
  const store = openStore(join(testHome(t), 'store.db')); t.after(() => store.close());
  const first = store.ensureDefaultAgent(defaults), second = store.createAgent({ name: 'Two', ...defaults });
  const origin = { kind: 'line' as const, to: 'chat' };
  const one = store.createSession({ origin, agentId: first.id }), two = store.createSession({ origin, agentId: second.id });
  store.appendMessages(one.id, [message('needle ไป one')]); store.appendMessages(two.id, [message('needle ไป two')]);
  const user = store.addMemory('user', 'needle ไป shared', second.id);
  const a = store.addMemory('agent', 'needle ไป first', first.id), b = store.addMemory('agent', 'needle ไป second', second.id);
  assert.equal(user.agentId, null);
  assert.throws(() => store.addMemory('agent', 'unowned'), /agentId/);
  assert.throws(() => store.addMemory('agent', 'unowned', 'unknown'), /unknown agent/);
  assert.throws(() => store.createSession({ origin, agentId: 'unknown' }), /unknown agent/);
  assert.deepEqual(store.listSessions({ agentId: first.id }).map(s => s.id), [one.id]);
  assert.equal(store.findSessionByOrigin(origin, first.id)?.id, one.id);
  assert.equal(store.findSessionByOrigin(origin, second.id)?.id, two.id);
  assert.deepEqual(store.listMemory(undefined, first.id).map(n => n.id), [user.id, a.id]);
  assert.deepEqual(store.listMemory('agent', second.id).map(n => n.id), [b.id]);
  for (const q of ['needle', 'ไป']) {
    assert.deepEqual(store.searchMessages(q, 20, first.id).map(h => h.sessionId), [one.id]);
    assert.deepEqual(new Set(store.searchMemory(q, 20, undefined, second.id).map(n => n.id)), new Set([user.id, b.id]));
    assert.deepEqual(store.searchMemory(q, 20, 'agent', first.id).map(n => n.id), [a.id]);
  }
  const job = { id: 'one', agentId: first.id, cron: '* * * * *', prompt: 'task', delivery: { kind: 'desktop' as const }, enabled: true };
  store.saveJob(job); store.saveJob({ ...job, id: 'two', agentId: second.id });
  assert.deepEqual(store.listJobs(first.id), [job]);
  assert.equal(store.deleteAgent(first.id), true);
  assert.deepEqual(store.getMessages(one.id), []); assert.equal(store.getSession(one.id), undefined);
  for (const q of ['needle', 'ไป']) {
    assert.deepEqual(store.searchMessages(q).map(h => h.sessionId), [two.id]);
    assert.deepEqual(new Set(store.searchMemory(q).map(n => n.id)), new Set([user.id, b.id]));
  }
  assert.deepEqual(store.listJobs().map(j => j.id), ['two']);
  assert.equal(store.getAgent(second.id)?.id, second.id);
});

test('opening a pre-agents database preserves sessions, messages, context, memory, jobs and FTS; reopening is idempotent', t => {
  const file = join(testHome(t), 'legacy.db'), db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('./pre-agents.sql', import.meta.url), 'utf8'));
  const msgs = [message('legacy needle ภาษาไทย')], origin = { kind: 'line', to: 'chat' };
  const job = { id: 'legacy-job', cron: '0 9 * * *', prompt: 'legacy prompt', delivery: { kind: 'desktop' }, enabled: false, lastRunAt: 123, lastStatus: 'ok' };
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?)').run('legacy-session', 'legacy title', JSON.stringify(origin), JSON.stringify(msgs), 100, 200);
  db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?, ?)').run(7, 'legacy-session', 'user', JSON.stringify(msgs[0]!.content), 'legacy needle ภาษาไทย', 150);
  db.prepare('INSERT INTO memory VALUES (?, ?, ?, ?, ?)').run(8, 'user', 'shared legacy needle', 100, 200);
  db.prepare('INSERT INTO memory VALUES (?, ?, ?, ?, ?)').run(9, 'agent', 'agent legacy needle', 101, 201);
  db.prepare('INSERT INTO jobs VALUES (?, ?)').run(job.id, JSON.stringify(job));
  db.close();
  let agentId = '';
  for (let i = 0; i < 2; i++) {
    const store = openStore(file);
    try {
      const first = store.ensureDefaultAgent(defaults); agentId ||= first.id;
      assert.equal(first.id, agentId); assert.equal(store.listAgents().length, 1);
      assert.deepEqual(store.getSession('legacy-session'), { id: 'legacy-session', title: 'legacy title', origin, context: msgs, agentId, createdAt: 100, updatedAt: 200 });
      assert.deepEqual(store.getMessages('legacy-session'), msgs);
      assert.deepEqual(store.listMemory().map(n => [n.id, n.agentId, n.text, n.createdAt, n.updatedAt]), [
        [8, null, 'shared legacy needle', 100, 200], [9, agentId, 'agent legacy needle', 101, 201],
      ]);
      assert.deepEqual(store.listJobs(), [{ ...job, agentId }]);
      assert.equal(store.searchMessages('needle', 20, agentId)[0]?.sessionId, 'legacy-session');
      assert.equal(store.searchMemory('needle', 20, undefined, agentId).length, 2);
    } finally { store.close(); }
  }
});

test('a partially migrated database adds only the missing columns and assigns orphan rows to the first agent', t => {
  const file = join(testHome(t), 'partial.db'), db = new DatabaseSync(file);
  db.exec(readFileSync(new URL('./pre-agents.sql', import.meta.url), 'utf8'));
  db.exec('ALTER TABLE sessions ADD COLUMN agentId TEXT');
  db.prepare('INSERT INTO sessions VALUES (?, ?, ?, ?, ?, ?, ?)').run('orphan', 'saved', '{"kind":"desktop"}', '[]', 1, 2, 'gone');
  db.close();
  const store = openStore(file); t.after(() => store.close());
  const existing = store.createAgent({ name: 'Existing', ...defaults });
  assert.equal(store.ensureDefaultAgent(defaults).id, existing.id);
  assert.equal(store.getSession('orphan')?.agentId, existing.id);
  assert.equal(store.listAgents().length, 1);
});
