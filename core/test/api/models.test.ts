import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { startDaemon } from '../../src/app/daemon.ts';
import { setSecret } from '../../src/config.ts';
import { OLLAMA_CONTEXT_NOTE } from '../../src/providers/ollama.ts';
import { configured, testHome } from '../e2e/helpers.ts';

test('model/status routes use local providers and saved optional keys, and report empty/failed lists', async t => {
  let data: unknown = [{ id: 'qwen3:14b' }, { id: 'other' }], status = 200;
  const calls: { path: string; auth?: string }[] = [];
  const server = createServer((req, res) => {
    calls.push({ path: req.url!, auth: req.headers.authorization });
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(status !== 200 ? 'failed test-key' : JSON.stringify(req.url === '/api/ps'
      ? { models: [{ name: 'qwen3:14b', context_length: 4096 }] } : { data }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`, home = testHome(t);
  configured(home, baseUrl, c => {
    c.providers = [{ id: 'ollama', kind: 'openai-compatible', baseUrl, apiKeyEnv: 'OLLAMA_API_KEY', contextWindow: 32768 },
      { id: 'remote', kind: 'openai-compatible', baseUrl, apiKeyEnv: 'REMOTE_KEY' },
      { id: 'offline', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }];
    c.active.provider = 'ollama';
  });
  const app = await startDaemon({ home }); t.after(() => app.close());
  const get = async (id: string, action: string) => {
    const res = await fetch(`http://127.0.0.1:${app.port}/api/providers/${id}/${action}`, { headers: { Authorization: `Bearer ${app.token}` } });
    return { status: res.status, body: await res.json() as any };
  };
  for (const id of ['ollama', 'remote']) {
    const list = await get(id, 'models');
    assert.equal(list.status, 200); assert.deepEqual(list.body, { ok: true, models: data });
    assert.equal(calls.at(-1)?.auth, undefined); assert.equal(calls.at(-1)?.path, '/v1/models');
    setSecret(id === 'ollama' ? 'OLLAMA_API_KEY' : 'REMOTE_KEY', 'test-key', home);
    assert.equal((await get(id, 'models')).body.ok, true); assert.equal(calls.at(-1)?.auth, 'Bearer test-key');
  }
  const report = await get('ollama', 'status');
  assert.equal(report.status, 200); assert.equal(report.body.note, OLLAMA_CONTEXT_NOTE);
  assert.match(report.body.warnings[0], /qwen3:14b.*4096-token.*32768/);
  assert.equal(calls.at(-1)?.path, '/api/ps'); assert.equal(calls.at(-1)?.auth, 'Bearer test-key');
  const count = calls.length;
  assert.deepEqual((await get('remote', 'status')).body, { warnings: [] }); assert.equal(calls.length, count);
  for (data of [[], null]) {
    assert.deepEqual((await get('ollama', 'models')).body, { ok: false, models: [], error: 'Ollama has no models yet (install one with "ollama pull qwen3")' });
    assert.deepEqual((await get('remote', 'models')).body, { ok: false, models: [], error: 'The provider returned no models' });
  }
  status = 500;
  const failed = await get('remote', 'models'); assert.equal(failed.status, 200); assert.equal(failed.body.ok, false);
  assert.match(failed.body.error, /500/); assert.ok(!failed.body.error.includes('test-key'));
  const offline = await get('offline', 'models'); assert.equal(offline.status, 200); assert.equal(offline.body.ok, false);
  const config = app.config(); config.providers[0]!.baseUrl = 'http://127.0.0.1:1/v1';
  const res = await fetch(`http://127.0.0.1:${app.port}/api/settings`, { method: 'PUT', headers: { Authorization: `Bearer ${app.token}` }, body: JSON.stringify({ config }) });
  assert.equal(res.status, 200);
  const stopped = await get('ollama', 'models'); assert.equal(stopped.status, 200); assert.equal(stopped.body.ok, false);
  assert.match(stopped.body.error, /Ollama is not running at http:\/\/127.0.0.1:1/);
  for (const action of ['models', 'status']) assert.equal((await get('missing', action)).status, 404);
});
