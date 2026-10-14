import test from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/api.ts';
import { mountProviders } from '../src/settings/providers.ts';
import { agent, config } from './agent-fixture.ts';
import { TestNode, installDom, json, flush } from './dom-fixture.ts';

const control = (node: TestNode, label: string) => {
  const field = node.querySelectorAll('.field').find(f => f.querySelector('.field-label')?.textContent === label)!;
  return field.querySelector('input') ?? field.querySelector('select')!;
};

test('Providers loads model suggestions and Ollama note/warnings with an optional API key label', async t => {
  t.after(installDom());
  const stored = structuredClone(config);
  stored.providers = [{ id: 'ollama', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1', apiKeyEnv: 'OLLAMA_API_KEY' },
    { id: 'remote', kind: 'anthropic', baseUrl: 'http://127.0.0.1:1' }];
  const pending = Promise.withResolvers<Response>(); const writes: any[] = [];
  const api = createApi({ port: 1, token: 'test-token', fetch: (async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/settings') return json({ config: stored, secrets: {} });
    if (path === '/api/agents') return json({ agents: [{ ...agent, provider: 'ollama' }] });
    if (path.endsWith('/status')) return json(path.includes('/ollama/') ? { note: 'Ollama context note', warnings: ['Small context'] } : { warnings: [] });
    if (path === '/api/providers/ollama/models') return pending.promise;
    if (path === '/api/providers/remote/models') return json({ ok: false, models: [], error: 'No models' });
    if (init?.method === 'PATCH') { writes.push(JSON.parse(String(init.body))); return json(agent); }
    assert.fail(path);
  }) as typeof fetch });
  const pane = new TestNode('div'); mountProviders(pane as unknown as HTMLElement, api); await flush();
  assert.ok(pane.textContent.includes('API key (optional): not set'));
  assert.ok(pane.textContent.includes('Ollama context note'));
  assert.ok(pane.querySelectorAll('.warn').some(n => n.textContent === 'Small context'));
  const model = control(pane, 'Model'), provider = control(pane, 'Provider');
  model.value = 'typed/custom'; pending.resolve(json({ ok: true, models: [{ id: 'suggestion' }] })); await flush();
  assert.equal(model.value, 'typed/custom'); assert.equal(pane.querySelector('datalist')!.querySelector('option')!.value, 'suggestion');
  provider.value = 'remote'; provider.fire('change'); await flush();
  assert.equal(model.value, 'typed/custom'); assert.match(pane.textContent, /Couldn't load the model list: No models\. You can still type a model id\./);
  pane.querySelectorAll('button').find(b => b.textContent === 'Save')!.fire('click'); await flush();
  assert.deepEqual(writes, [{ provider: 'remote', model: 'typed/custom' }]);
});
