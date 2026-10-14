import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openStore } from '../../src/store/index.ts';
import { startDaemon } from '../../src/app/daemon.ts';
import { configured, testHome } from '../e2e/helpers.ts';

test('max_tokens migrates a v1 agents database idempotently without changing agents or sessions', t => {
  const file = join(testHome(t), 'v1.db'), db = new DatabaseSync(file);
  db.exec(`CREATE TABLE agents (id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, instructions TEXT NOT NULL,
    provider TEXT NOT NULL, model TEXT NOT NULL, permissions TEXT NOT NULL, connectors TEXT NOT NULL, skills TEXT NOT NULL,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    INSERT INTO agents VALUES ('old', 'Old', 'x', '', 'mock', 'old/model', '{}', 'null', 'null', 1, 2);
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, origin TEXT NOT NULL, context TEXT NOT NULL,
      created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, agentId TEXT);
    INSERT INTO sessions VALUES ('saved', 'Saved', '{"kind":"desktop"}', '[]', 1, 2, 'old');`);
  db.close();
  for (let i = 0; i < 2; i++) {
    const store = openStore(file);
    try {
      assert.equal(store.getAgent('old')?.model, 'old/model');
      assert.ok(!Object.hasOwn(store.getAgent('old')!, 'maxTokens'));
      assert.equal(store.getSession('saved')?.agentId, 'old');
      const a = store.createAgent({ name: 'New', provider: 'mock', model: 'any/model', maxTokens: 512 });
      assert.equal(store.getAgent(a.id)?.maxTokens, 512);
      assert.equal(store.updateAgent(a.id, { maxTokens: 1000000 })?.maxTokens, 1000000);
      assert.equal(store.updateAgent(a.id, { name: 'Renamed' })?.maxTokens, 1000000);
      assert.ok(!Object.hasOwn(store.updateAgent(a.id, { maxTokens: null })!, 'maxTokens'));
      assert.ok(!Object.hasOwn(store.getAgent(a.id)!, 'maxTokens'));
    } finally { store.close(); }
  }
  const check = new DatabaseSync(file);
  try { assert.equal(check.prepare('PRAGMA table_info(agents)').all().filter(r => r.name === 'max_tokens').length, 1); }
  finally { check.close(); }
});

test('agent API creates, updates and clears max tokens and validates arbitrary model ids', async t => {
  const home = testHome(t); configured(home);
  const app = await startDaemon({ home }); t.after(() => app.close());
  const call = async (method: string, path: string, body: unknown) => {
    const res = await fetch(`http://127.0.0.1:${app.port}${path}`, { method,
      headers: { Authorization: `Bearer ${app.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  const created = await call('POST', '/api/agents', { name: 'Any', model: 'typed/not-listed', maxTokens: 512 });
  assert.equal(created.status, 201); assert.equal(created.body.maxTokens, 512);
  const path = `/api/agents/${created.body.id}`;
  assert.equal((await call('PATCH', path, { maxTokens: 1 })).body.maxTokens, 1);
  assert.ok(!Object.hasOwn((await call('PATCH', path, { maxTokens: null })).body, 'maxTokens'));
  for (const [field, values] of Object.entries({ maxTokens: [0, 1000001, 1.5, '512'], model: ['', 'x'.repeat(201), 'a\nb', 'a\x7fb', 'a\x85b', 1] })) {
    for (const value of values) for (const [method, route] of [['POST', '/api/agents'], ['PATCH', path]]) {
      const result = await call(method!, route!, { name: 'Any', [field]: value });
      assert.equal(result.status, 400); assert.equal(result.body.error, `invalid ${field}`);
    }
  }
  for (const method of ['POST', 'PATCH']) {
    const result = await call(method, method === 'POST' ? '/api/agents' : path, { name: 'Any', effort: null });
    assert.equal(result.status, 400); assert.equal(result.body.error, 'unknown agent field');
  }
  assert.equal((await call('POST', '/api/agents', { name: 'Long model', model: 'x'.repeat(200), maxTokens: null })).status, 201);
});
