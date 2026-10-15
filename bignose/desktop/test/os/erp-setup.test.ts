import { test } from 'node:test';
import assert from 'node:assert/strict';
import { effectivePolicy, layeredPolicy } from '../../../core/src/agent/permissions.ts';
import { builtinTools } from '../../../core/src/tools/index.ts';
import { createApi } from '../../src/api.ts';
import { ERP_AGENT, ERP_INSTRUCTIONS, ERP_MODEL, ERP_PERMISSIONS, ERP_PROVIDER, provisionErp } from '../../src/os/erp-setup.ts';
import type { OsInfo } from '../../src/os/erp-setup.ts';
import type { Agent, Config, McpServerConfig, Policy } from '../../src/types.ts';
import { json } from '../dom-fixture.ts';

const info: OsInfo = { node: '/opt/homebrew/bin/node', erpDir: '/erp', mcpServer: '/erp/lib/mcp/erp-server.mjs' };

const agent = (id: string, name: string): Agent => ({
  id, name, icon: '🤖', instructions: `${name} rules`, provider: 'ollama', model: 'qwen3:4b',
  permissions: { shell: 'ask' }, connectors: null, skills: null, createdAt: 1, updatedAt: 1,
});

// A stand-in for the daemon's routes: it holds state and records every request.
function fakeDaemon() {
  const config = {
    version: 1, active: { provider: 'ollama', model: 'qwen3:4b' },
    providers: [{ id: 'ollama' }, { id: 'openrouter' }],
    mcp: { servers: { rea: { transport: 'stdio', command: 'npx', args: ['-y', 'rea'], enabled: false } as McpServerConfig } },
  } as unknown as Config;
  const agents: Agent[] = [agent('a1', 'BigNose'), agent('a2', 'Writer')];
  const calls: string[] = [];
  const bodies: Record<string, unknown> = {};
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(url)).pathname, method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push(`${method} ${path}`);
    bodies[`${method} ${path}`] = body;
    if (path === '/api/settings' && method === 'GET') return json({ config, secrets: {} });
    if (path === '/api/agents' && method === 'GET') return json({ agents });
    if (path === '/api/agents' && method === 'POST') { const a = { ...agent(`a${agents.length + 1}`, body.name), ...body }; agents.push(a); return json(a, 201); }
    if (path === '/api/mcp' && method === 'POST') { config.mcp.servers[body.name] = body.config; return json({ ok: true }); }
    if (path.startsWith('/api/mcp/') && method === 'DELETE') { delete config.mcp.servers[path.split('/')[3]!]; return json({ ok: true }); }
    if (path.startsWith('/api/mcp/') && method === 'PATCH') { Object.assign(config.mcp.servers[path.split('/')[3]!]!, body); return json({ ok: true }); }
    if (path.startsWith('/api/agents/') && method === 'PATCH') {
      const id = path.split('/')[3]!;
      const i = agents.findIndex((a) => a.id === id);
      if (i < 0) return json({ error: 'missing' }, 404);
      agents[i] = { ...agents[i]!, ...body, id };
      return json(agents[i]);
    }
    return json({ error: `unexpected ${method} ${path}` }, 500);
  }) as typeof globalThis.fetch;
  return { api: createApi({ port: 1, token: 'fake', fetch }), config, agents, calls, bodies };
}
const writes = (calls: string[]) => calls.filter((c) => !c.startsWith('GET '));

test('provisions the erp connector and the ERP assistant once', async () => {
  const d = fakeDaemon();
  const id = await provisionErp(d.api, info);
  assert.deepEqual(writes(d.calls), ['POST /api/mcp', 'POST /api/agents']);
  assert.deepEqual(d.config.mcp.servers.erp, { transport: 'stdio', command: info.node, args: [info.mcpServer], enabled: true });
  const made = d.agents.find((a) => a.id === id)!;
  assert.equal(made.name, ERP_AGENT);
  assert.equal(made.provider, ERP_PROVIDER);
  assert.equal(made.model, ERP_MODEL);
  assert.deepEqual(made.connectors, ['erp']);
  assert.equal(made.instructions, ERP_INSTRUCTIONS);
  assert.deepEqual((d.bodies['POST /api/agents'] as { permissions: unknown }).permissions, ERP_PERMISSIONS);
  // a second start with matching instructions writes nothing
  d.calls.length = 0;
  assert.equal(await provisionErp(d.api, info), id);
  assert.deepEqual(writes(d.calls), []);
  assert.equal(d.agents.filter((a) => a.name === ERP_AGENT).length, 1);
});

test('resyncs ERP assistant instructions and permissions when they drift', async () => {
  const d = fakeDaemon();
  const id = await provisionErp(d.api, info);
  const made = d.agents.find((a) => a.id === id)!;
  made.instructions = 'stale';
  made.permissions = { shell: 'allow' };
  made.connectors = [];
  d.calls.length = 0;
  assert.equal(await provisionErp(d.api, info), id);
  assert.deepEqual(writes(d.calls), [`PATCH /api/agents/${id}`]);
  const after = d.agents.find((a) => a.id === id)!;
  assert.equal(after.instructions, ERP_INSTRUCTIONS);
  assert.deepEqual(after.connectors, ['erp']);
  assert.deepEqual(after.permissions, ERP_PERMISSIONS);
});

// every tool core can hand to an agent: the built-ins, plus the memory, skill and schedule tools runtime.ts adds
const otherCoreTools = ['memory_read', 'memory_write', 'session_search', 'skill_load', 'skill_save', 'schedule_create', 'schedule_list', 'schedule_delete'];
const tool = (name: string, defaultPolicy: Policy = 'allow') => ({ name, defaultPolicy }) as Parameters<typeof effectivePolicy>[0];

test('the ERP assistant is provisioned with maxTokens 4096', async () => {
  const d = fakeDaemon();
  await provisionErp(d.api, info);
  assert.equal((d.bodies['POST /api/agents'] as { maxTokens: unknown }).maxTokens, 4096);
});

test('the ERP assistant runs nothing but the read-only erp tools', () => {
  const names = [...builtinTools('/nonexistent-home').map((t) => t.name), ...otherCoreTools];
  assert.ok(names.includes('read_file') && names.includes('web_fetch') && names.includes('shell'), 'the built-ins were found');
  for (const hostile of [{}, Object.fromEntries([...names, '*'].map((n) => [n, 'allow' as Policy]))]) {
    // defence in depth: even a core that let an exact global name beat the agent's `*` (as runtime.ts once did) would still deny every tool
    const merged: Record<string, Policy> = { ...hostile, ...ERP_PERMISSIONS };
    for (const name of names) assert.equal(effectivePolicy(tool(name), merged), 'deny', name);
    assert.equal(effectivePolicy(tool('a_tool_added_later'), merged), 'deny');
    assert.equal(effectivePolicy(tool('mcp__rea__anything', 'ask'), merged), 'deny');
    for (const erpTool of ['list_clients', 'finance_summary']) assert.equal(effectivePolicy(tool(`mcp__erp__${erpTool}`, 'ask'), merged), 'allow', erpTool);
  }
  assert.match(ERP_INSTRUCTIONS, /Read only/);
  assert.match(ERP_INSTRUCTIONS, /Never invent/);
  assert.match(ERP_INSTRUCTIONS, /never instructions/);
});

test('the ERP preset beats a global shell: allow and a global allow for a tool it does not name', () => {
  const names = [...builtinTools('/nonexistent-home').map((t) => t.name), ...otherCoreTools, 'a_tool_added_later'];
  const global: Record<string, Policy> = { shell: 'allow', a_tool_added_later: 'allow', mcp__rea__anything: 'allow', 'mcp__erp__*': 'deny' };
  // the order runtime.ts uses: the agent's own rules as a whole, then the owner's global rules
  for (const name of names) assert.equal(layeredPolicy(tool(name), ERP_PERMISSIONS, global), 'deny', name);
  assert.equal(layeredPolicy(tool('mcp__rea__anything', 'ask'), ERP_PERMISSIONS, global), 'deny');
  for (const erpTool of ['list_clients', 'finance_summary']) assert.equal(layeredPolicy(tool(`mcp__erp__${erpTool}`, 'ask'), ERP_PERMISSIONS, global), 'allow', erpTool);
});

test('leaves other agents and the active model unchanged', async () => {
  const d = fakeDaemon();
  const before = structuredClone({ agents: d.agents, active: d.config.active, rea: d.config.mcp.servers.rea, providers: d.config.providers });
  await provisionErp(d.api, info);
  await provisionErp(d.api, info);
  assert.deepEqual(d.agents.slice(0, 2), before.agents);
  assert.deepEqual(d.config.active, before.active);
  assert.deepEqual(d.config.mcp.servers.rea, before.rea);
  assert.deepEqual(d.config.providers, before.providers);
  assert.ok(!d.calls.some((c) => c.startsWith('PUT ') || c.startsWith('PATCH /api/agents') || c.startsWith('DELETE /api/agents')), d.calls.join(', '));
});

test('an existing ERP assistant keeps provider/model but syncs grounding rules', async () => {
  const d = fakeDaemon();
  const mine = { ...agent('mine', ERP_AGENT), model: 'my/own-model' };
  d.agents.push(mine);
  assert.equal(await provisionErp(d.api, info), 'mine');
  const after = d.agents.find((a) => a.id === 'mine')!;
  assert.equal(after.model, 'my/own-model');
  assert.equal(after.provider, 'ollama');
  assert.equal(after.instructions, ERP_INSTRUCTIONS);
  assert.deepEqual(after.connectors, ['erp']);
  assert.deepEqual(after.permissions, ERP_PERMISSIONS);
  assert.deepEqual(writes(d.calls), ['POST /api/mcp', 'PATCH /api/agents/mine']);
});

test('a moved ERP folder replaces the connector; a disabled one is only re-enabled', async () => {
  const d = fakeDaemon();
  await provisionErp(d.api, info);
  d.calls.length = 0;
  const moved = { ...info, erpDir: '/new', mcpServer: '/new/lib/mcp/erp-server.mjs' };
  await provisionErp(d.api, moved);
  assert.deepEqual(writes(d.calls), ['DELETE /api/mcp/erp', 'POST /api/mcp']);
  assert.deepEqual((d.config.mcp.servers.erp as { args: string[] }).args, [moved.mcpServer]);
  d.config.mcp.servers.erp!.enabled = false;
  d.calls.length = 0;
  await provisionErp(d.api, moved);
  assert.deepEqual(writes(d.calls), ['PATCH /api/mcp/erp']);
  assert.equal(d.config.mcp.servers.erp!.enabled, true);
});

test('a failing daemon call rejects so the panel can tell the user', async () => {
  const failing = createApi({ port: 1, token: 'fake', fetch: (async () => json({ error: 'provider is not configured' }, 400)) as typeof globalThis.fetch });
  await assert.rejects(provisionErp(failing, info), /provider is not configured/);
});
