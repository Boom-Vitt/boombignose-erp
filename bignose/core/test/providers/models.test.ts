import test from 'node:test';
import assert from 'node:assert/strict';
import { listModels } from '../../src/providers/models.ts';
import type { ProviderConfig } from '../../src/types.ts';

const remote: ProviderConfig = { id: 'remote', kind: 'openai-compatible', baseUrl: 'https://example.invalid/v1///' };
const ollama: ProviderConfig = { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1' };

test('compatible model lists preserve string ids in server order with optional Bearer auth', async t => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 15000);
    return timeout(ms);
  });
  for (const key of [undefined, '', 'test-key']) {
    const models = await listModels(remote, key, async (url, init) => {
      assert.equal(String(url), 'https://example.invalid/v1/models');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      assert.equal(new Headers(init.headers).get('Authorization'), key ? 'Bearer test-key' : null);
      return Response.json({ object: 'list', data: [{ id: 'second' }, { id: 7 }, null, {}, { id: 'first', display_name: 'Ignored' }] });
    });
    assert.deepEqual(models, [{ id: 'second' }, { id: 'first' }]);
  }
});

test('anthropic requests the first page with its headers and display names', async () => {
  const cfg: ProviderConfig = { id: 'a', kind: 'anthropic', baseUrl: 'https://example.invalid///' };
  const models = await listModels(cfg, 'test-key', async (url, init) => {
    assert.equal(String(url), 'https://example.invalid/v1/models?limit=1000');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal instanceof AbortSignal);
    const headers = new Headers(init.headers);
    assert.equal(headers.get('x-api-key'), 'test-key');
    assert.equal(headers.get('anthropic-version'), '2023-06-01');
    assert.equal(headers.has('Authorization'), false);
    return Response.json({ data: [{ id: 'a', display_name: 'Model A' }, { id: 'b' }, { id: 'c', display_name: 4 }], has_more: true, last_id: 'c' });
  });
  assert.deepEqual(models, [{ id: 'a', label: 'Model A' }, { id: 'b' }, { id: 'c' }]);
});

for (const cfg of [ollama, { ...ollama, id: 'custom' }]) {
  for (const reason of ['connection refused', 'DNS failed', 'timeout']) {
    test(`${cfg.id} reports ${reason} with the Ollama startup instructions`, async () => {
      await assert.rejects(listModels(cfg, 'test-key', async () => { throw new Error(reason); }), {
        message: 'Ollama is not running at http://localhost:11434 (start it with "ollama serve" or open the Ollama app)',
      });
    });
  }
}

test('other unreachable providers report a masked reason without a trailing period', async () => {
  for (const reason of [new Error('connection refused for test-key.'), 'connection refused for test-key.']) {
    await assert.rejects(listModels(remote, 'test-key', async () => { throw reason; }), {
      message: 'Could not list models: connection refused for ••••',
    });
  }
});

test('empty and null data give actionable no-models errors', async () => {
  for (const data of [[], null, [{ id: 2 }]]) {
    await assert.rejects(listModels(ollama, undefined, async () => Response.json({ object: 'list', data })), {
      message: 'Ollama has no models yet (install one with "ollama pull qwen3:4b")',
    });
    await assert.rejects(listModels(remote, undefined, async () => Response.json({ object: 'list', data })), {
      message: 'The provider returned no models',
    });
  }
});

test('HTTP failures report the status and cap the redacted body at 200 characters', async () => {
  for (const cfg of [remote, ollama, { ...remote, kind: 'anthropic' as const }]) {
    await assert.rejects(listModels(cfg, 'test-key', async () => new Response('test-key ' + 'x'.repeat(250), { status: 429 })), {
      message: 'Could not list models: 429 •••• ' + 'x'.repeat(195),
    });
    await assert.rejects(listModels(cfg, 'test-key', async () => new Response('blocked test-key.', { status: 403 })), {
      message: 'Could not list models: 403 blocked ••••',
    });
    // Mask before truncating, including a key that crosses the 200-character boundary.
    await assert.rejects(listModels(cfg, 'test-key', async () => new Response('x'.repeat(198) + 'test-key', { status: 500 })), {
      message: 'Could not list models: 500 ' + 'x'.repeat(198) + '••',
    });
  }
});

test('malformed JSON and non-array data fail with the unexpected-response text', async () => {
  for (const cfg of [remote, ollama]) {
    for (const value of [null, [], {}, { data: 'test-key' }, { data: {} }, { data: false }]) {
      await assert.rejects(listModels(cfg, 'test-key', async () => Response.json(value)), {
        message: 'Could not list models: unexpected response',
      });
    }
    await assert.rejects(listModels(cfg, 'test-key', async () => new Response('bad JSON test-key')), {
      message: 'Could not list models: unexpected response',
    });
  }
});

test('model list errors mask an escaped key and a key in the Ollama origin', async () => {
  const key = 'fake-"key';
  await assert.rejects(listModels(remote, key, async () => { throw new Error(JSON.stringify(key)); }), {
    message: 'Could not list models: "••••"',
  });
  await assert.rejects(listModels({ ...ollama, baseUrl: 'http://test-key.invalid/v1' }, 'test-key', async () => { throw new Error('refused'); }), {
    message: 'Ollama is not running at http://••••.invalid (start it with "ollama serve" or open the Ollama app)',
  });
});

test('a model list timeout aborts the request and reports the Ollama startup instructions', async t => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 15000);
    return timeout(5);
  });
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  await assert.rejects(listModels(ollama, undefined, async (_, init) => {
    return await new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  }), {
    message: 'Ollama is not running at http://localhost:11434 (start it with "ollama serve" or open the Ollama app)',
  });
});
