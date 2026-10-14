import test from 'node:test';
import assert from 'node:assert/strict';
import { isOllama, ollamaWarnings, OLLAMA_CONTEXT_NOTE, OLLAMA_DEFAULT_MODEL } from '../../src/providers/ollama.ts';
import type { ProviderConfig } from '../../src/types.ts';

const cfg: ProviderConfig = { id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://localhost:11434/v1', contextWindow: 32768 };

test('Ollama recognition requires a compatible provider and its id or port', () => {
  assert.equal(isOllama(cfg), true);
  assert.equal(isOllama({ ...cfg, baseUrl: 'https://example.invalid/v1' }), true);
  assert.equal(isOllama({ ...cfg, id: 'local' }), true);
  assert.equal(isOllama({ ...cfg, kind: 'anthropic' }), false);
  assert.equal(isOllama({ ...cfg, id: 'local', baseUrl: 'http://localhost:1234/v1' }), false);
  assert.equal(isOllama({ ...cfg, id: 'local', baseUrl: 'http://11434.example.invalid/v1' }), false);
  assert.equal(isOllama({ ...cfg, id: 'local', baseUrl: 'invalid' }), false);
});

test('Ollama guidance uses the agreed model and exact context note', () => {
  assert.equal(OLLAMA_DEFAULT_MODEL, 'qwen3:4b');
  assert.equal(OLLAMA_CONTEXT_NOTE, 'Ollama picks its own context size (OLLAMA_CONTEXT_LENGTH, only 4096 tokens on machines with less than 24 GB of GPU memory) and cuts longer prompts without an error. For agents, start Ollama with OLLAMA_CONTEXT_LENGTH=32768 ollama serve (for the Ollama app: launchctl setenv OLLAMA_CONTEXT_LENGTH 32768, then restart the app) and keep Context window here at or below that number. ollama ps shows the size in use.');
});

test('loaded models warn below the provider context window using the origin and optional auth', async t => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 2000);
    return timeout(ms);
  });
  for (const key of [undefined, '', 'test-key']) {
    const warnings = await ollamaWarnings(cfg, key, async (url, init) => {
      assert.equal(String(url), 'http://localhost:11434/api/ps');
      assert.equal(init?.method, 'GET');
      assert.equal(init?.redirect, 'error');
      assert.ok(init?.signal instanceof AbortSignal);
      assert.equal(init.signal.aborted, false);
      assert.equal(new Headers(init.headers).get('Authorization'), key ? 'Bearer test-key' : null);
      return Response.json({ models: [
        { name: 'qwen3:14b', context_length: 4096 },
        { name: 'equal', context_length: 32768 },
        { name: 'larger', context_length: 65536 },
        { name: 'small', context_length: 8192 },
      ] });
    });
    assert.deepEqual(warnings, [
      'Ollama is running qwen3:14b with a 4096-token context, below this provider\'s Context window (32768). Restart Ollama with OLLAMA_CONTEXT_LENGTH=32768, or set Context window to 4096.',
      'Ollama is running small with a 8192-token context, below this provider\'s Context window (32768). Restart Ollama with OLLAMA_CONTEXT_LENGTH=32768, or set Context window to 8192.',
    ]);
  }
});

test('an absent context window uses 128000 tokens', async () => {
  const warnings = await ollamaWarnings({ ...cfg, contextWindow: undefined }, undefined,
    async () => Response.json({ models: [{ name: 'qwen3', context_length: 32768 }, { name: 'equal', context_length: 128000 }] }));
  assert.deepEqual(warnings, [
    'Ollama is running qwen3 with a 32768-token context, below this provider\'s Context window (128000). Restart Ollama with OLLAMA_CONTEXT_LENGTH=128000, or set Context window to 32768.',
  ]);
});

test('unreachable Ollama reports startup instructions without exposing the key', async () => {
  for (const reason of [new Error('refused test-key'), new Error('DNS failed'), new DOMException('timeout', 'TimeoutError')]) {
    assert.deepEqual(await ollamaWarnings(cfg, 'test-key', async () => { throw reason; }), [
      'Ollama is not running at http://localhost:11434 (start it with "ollama serve" or open the Ollama app)',
    ]);
  }
});

test('failed HTTP answers, malformed JSON, missing models and invalid entries give no warnings', async () => {
  const replies = [
    () => new Response('unavailable', { status: 503 }),
    () => new Response('bad JSON'),
    ...[null, [], {}, { models: null }, { models: {} }, { models: [] },
      { models: [null, {}, { name: 'qwen3', context_length: '4096' }, { context_length: 4096 }, { name: 4, context_length: 4096 }] },
    ].map(value => () => Response.json(value)),
  ];
  for (const reply of replies) assert.deepEqual(await ollamaWarnings(cfg, undefined, async () => reply()), []);
  assert.deepEqual(await ollamaWarnings({ ...cfg, baseUrl: 'invalid' }, undefined, async () => { throw new Error('should not fetch'); }), []);
});

test('Ollama warning text masks keys echoed by model names', async () => {
  assert.deepEqual(await ollamaWarnings(cfg, 'test-key', async () => Response.json({ models: [{ name: 'test-key', context_length: 4096 }] })), [
    'Ollama is running •••• with a 4096-token context, below this provider\'s Context window (32768). Restart Ollama with OLLAMA_CONTEXT_LENGTH=32768, or set Context window to 4096.',
  ]);
});

test('the two-second warning timeout aborts the request and never throws', async t => {
  const timeout = AbortSignal.timeout;
  t.mock.method(AbortSignal, 'timeout', (ms: number) => {
    assert.equal(ms, 2000);
    return timeout(5);
  });
  const keepAlive = setTimeout(() => {}, 1000);
  t.after(() => clearTimeout(keepAlive));
  const warnings = await ollamaWarnings(cfg, undefined, async (_, init) => {
    return await new Promise<Response>((_, reject) => init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true }));
  });
  assert.deepEqual(warnings, ['Ollama is not running at http://localhost:11434 (start it with "ollama serve" or open the Ollama app)']);
});
