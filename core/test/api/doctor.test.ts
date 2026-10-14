import test from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { startDaemon } from '../../src/app/daemon.ts';
import { maskSecret, setSecret } from '../../src/config.ts';
import { configured, testHome } from '../e2e/helpers.ts';

const baseUrl = 'https://doctor.invalid/v1';
const doctorUrls = [`${baseUrl}/models`, 'https://doctor.invalid/api/ps'];

async function app(t: TestContext, secret = '') {
  const home = testHome(t), urls: string[] = [], unexpected: string[] = [];
  configured(home, baseUrl, config => {
    config.providers[0]!.id = 'ollama'; config.active.provider = 'ollama';
    config.mcp.servers = {};
  });
  if (secret) setSecret('DOCTOR_TEST_SECRET', secret, home);
  let token = '';
  const daemon = await startDaemon({ home, fetchImpl: async input => {
    const url = String(input); urls.push(url);
    if (url === doctorUrls[0]) return secret
      ? new Response(`fake provider failure ${secret} ${token}`, { status: 503 })
      : Response.json({ object: 'list', data: [{ id: 'test-model' }] });
    if (url === doctorUrls[1]) return Response.json({ models: [] });
    unexpected.push(url); assert.fail('unexpected diagnostic fetch');
  } });
  token = daemon.token;
  t.after(async () => { await daemon.close(); assert.deepEqual(unexpected, []); });
  return { ...daemon, home, urls };
}

function call(a: Awaited<ReturnType<typeof app>>, method = 'POST', raw = '{}', headers: Record<string, string> = {}) {
  return new Promise<{ status: number; body: { code?: number; lines?: string[]; error?: string } }>((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port: a.port, path: '/api/doctor', method,
      headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json', ...headers },
      signal: AbortSignal.timeout(1500),
    }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; }); res.on('error', reject);
      res.on('end', () => {
        try { resolve({ status: res.statusCode!, body: JSON.parse(text) }); } catch (error) { reject(error); }
      });
    });
    req.on('error', reject); req.end(raw);
  });
}

test('T15 POST runs diagnostics for the daemon home through its injected fetch', { timeout: 2000 }, async t => {
  const a = await app(t), result = await call(a);
  assert.equal(result.status, 200); assert.equal(typeof result.body.code, 'number'); assert.equal(result.body.code, 0);
  assert.ok(Array.isArray(result.body.lines));
  assert.ok(result.body.lines.includes('ok sqlite + FTS5 trigram'));
  assert.ok(result.body.lines.includes('ok home writable'));
  assert.ok(result.body.lines.includes('ok Ollama has 1 models'));
  assert.deepEqual(a.urls, doctorUrls);
});

test('T15 POST requires the API token before running diagnostics', { timeout: 2000 }, async t => {
  const a = await app(t);
  for (const Authorization of ['', 'Bearer wrong']) assert.equal((await call(a, 'POST', '{}', { Authorization })).status, 401);
  assert.deepEqual(a.urls, []);
});

test('T15 POST rejects a foreign Host before running diagnostics', { timeout: 2000 }, async t => {
  const a = await app(t);
  assert.equal((await call(a, 'POST', '{}', { Host: 'foreign.invalid' })).status, 403);
  assert.deepEqual(a.urls, []);
});

test('T15 GET is an unknown route and does not run diagnostics', { timeout: 2000 }, async t => {
  const a = await app(t);
  assert.equal((await call(a, 'GET', '')).status, 404);
  assert.deepEqual(a.urls, []);
});

test('T15 POST masks home secrets and the API token in diagnostic errors', { timeout: 2000 }, async t => {
  const secret = ['fake', 'doctor', 'secret'].join('-'), a = await app(t, secret), result = await call(a);
  assert.equal(result.status, 200); assert.equal(result.body.code, 0);
  const output = JSON.stringify(result.body);
  assert.ok(!output.includes(secret), 'home secret must be masked');
  assert.ok(!output.includes(a.token), 'API token must be masked');
  assert.ok(result.body.lines?.some(line => line.includes('warn Could not list models: 503') && line.includes(maskSecret(secret)) && line.includes(maskSecret(a.token))));
  assert.deepEqual(a.urls, doctorUrls);
});

test('T15 POST ignores caller path command and url fields', { timeout: 2000 }, async t => {
  const a = await app(t), before = await call(a), path = join(a.home, 'caller-home'), marker = join(a.home, 'caller-command');
  const after = await call(a, 'POST', JSON.stringify({ path, command: `touch ${marker}`, url: 'https://caller.invalid' }));
  assert.equal(after.status, 200); assert.deepEqual(after.body, before.body);
  assert.deepEqual(a.urls, [...doctorUrls, ...doctorUrls]);
  assert.equal(existsSync(path), false); assert.equal(existsSync(marker), false);
});

test('T15 POST validates JSON object and body size before running diagnostics', { timeout: 2000 }, async t => {
  const a = await app(t);
  for (const raw of ['{', '[]']) assert.equal((await call(a, 'POST', raw)).status, 400);
  assert.equal((await call(a, 'POST', JSON.stringify({ text: 'x'.repeat(1024 * 1024) }))).status, 413);
  assert.deepEqual(a.urls, []);
});
