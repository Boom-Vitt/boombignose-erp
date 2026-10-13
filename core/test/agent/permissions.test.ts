import test from 'node:test';
import assert from 'node:assert/strict';
import { effectivePolicy, checkPermission } from '../../src/agent/permissions.ts';
import type { Tool } from '../../src/types.ts';

const tool: Tool = { name: 'mcp__rea__read', description: '', inputSchema: {}, defaultPolicy: 'ask', async run() { return { content: '' }; } };
const req = { id: 'a', sessionId: 's', origin: { kind: 'cli' as const }, tool: tool.name, input: {} };
test('exact policy wins over longest matching prefix and default', () => {
  assert.equal(effectivePolicy(tool, {}), 'ask');
  assert.equal(effectivePolicy(tool, { '*': 'deny', 'mcp__*': 'allow', 'mcp__rea__*': 'ask' }), 'ask');
  assert.equal(effectivePolicy(tool, { 'mcp__rea__*': 'allow', [tool.name]: 'deny' }), 'deny');
});
test('deny never asks and ask requires positive approval', async () => {
  assert.deepEqual(await checkPermission('allow', req), undefined);
  assert.deepEqual(await checkPermission('deny', req, async () => { throw new Error('must not ask'); }), { content: 'denied by policy', isError: true });
  for (const approve of [undefined, async () => false]) assert.deepEqual(await checkPermission('ask', req, approve), { content: 'denied by user', isError: true });
  assert.equal(await checkPermission('ask', req, async r => r.id === 'a'), undefined);
});
