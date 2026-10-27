import test from 'node:test';
import assert from 'node:assert/strict';
import { createProvider } from '../../src/providers/index.ts';
import { refusedCloudExamples } from '../../src/providers/local-only.ts';
import { listModels } from '../../src/providers/models.ts';
import { collect, request } from './helpers.ts';

test('cloud model hosts are refused before any request', async () => {
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error('fetch should not run'); };
  for (const baseUrl of refusedCloudExamples()) {
    await assert.rejects(async () => {
      await collect(createProvider({ id: 'x', kind: 'openai-compatible', baseUrl }, 'k', fetchImpl).stream(request));
    }, /refused/i);
    await assert.rejects(async () => {
      await collect(createProvider({ id: 'a', kind: 'anthropic', baseUrl }, 'k', fetchImpl).stream(request));
    }, /refused/i);
    await assert.rejects(async () => {
      await listModels({ id: 'x', kind: 'openai-compatible', baseUrl }, 'k', fetchImpl);
    }, /refused/i);
  }
  assert.equal(calls, 0);
});
