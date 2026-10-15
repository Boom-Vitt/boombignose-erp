import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePolicy, layeredPolicy, checkPermission } from '../../src/agent/permissions.ts';
import type { Tool } from '../../src/types.ts';

const tool: Tool = { name: 'mcp__rea__read', description: '', inputSchema: {}, defaultPolicy: 'ask', async run() { return { content: '' }; } };
const req = { id: 'a', sessionId: 's', origin: { kind: 'cli' as const }, tool: tool.name, input: {} };
test('exact policy wins over longest matching prefix and default', () => {
  assert.equal(effectivePolicy(tool, {}), 'ask');
  assert.equal(effectivePolicy(tool, { '*': 'deny', 'mcp__*': 'allow', 'mcp__rea__*': 'ask' }), 'ask');
  assert.equal(effectivePolicy(tool, { 'mcp__rea__*': 'allow', [tool.name]: 'deny' }), 'deny');
});
test("layers decide in order: the first layer's exact rule, its longest prefix rule, then the next layer, then the default", () => {
  const agent = { '*': 'deny', 'mcp__*': 'ask', 'mcp__rea__*': 'allow' } as const, global = { [tool.name]: 'deny', 'mcp__rea__*': 'deny' } as const;
  assert.equal(layeredPolicy(tool, agent, global), 'allow', "the agent's prefix rule beats the global exact rule");
  assert.equal(layeredPolicy(tool, { [tool.name]: 'ask', ...agent }, global), 'ask', "the agent's exact rule beats its own prefix rules");
  assert.equal(layeredPolicy(tool, { other: 'deny' }, global), 'deny', 'a layer with no matching rule leaves it to the next one');
  assert.equal(layeredPolicy(tool, {}, { 'mcp__*': 'allow', 'mcp__rea__*': 'deny' }), 'deny', 'the global longest prefix rule');
  assert.equal(layeredPolicy(tool, {}, {}), 'ask', 'the default');
});
test('deny never asks and ask requires positive approval', async () => {
  assert.deepEqual(await checkPermission('allow', req), undefined);
  assert.deepEqual(await checkPermission('deny', req, async () => { throw new Error('must not ask'); }), { content: 'denied by policy', isError: true });
  for (const approve of [undefined, async () => false]) assert.deepEqual(await checkPermission('ask', req, approve), { content: 'denied by user', isError: true });
  assert.equal(await checkPermission('ask', req, async r => r.id === 'a'), undefined);
});

test('invalid policy values are denied without asking', async () => {
  for (const policy of ['ASK', null, undefined, 1]) {
    assert.deepEqual(await checkPermission(policy as any, req, async () => { throw new Error('must not ask'); }), { content: 'invalid policy', isError: true });
  }
});
