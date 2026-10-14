import type { Agent, Config } from '../src/types.ts';
export const agent: Agent = { id: 'a1', name: 'One', icon: '🤖', instructions: 'One instruction', provider: 'local', model: 'one-model', permissions: {}, connectors: [], skills: null, createdAt: 1, updatedAt: 1 };
export const config: Config = {
  version: 1, active: { provider: 'local', model: 'seed-only' },
  providers: [{ id: 'local', kind: 'openai-compatible', baseUrl: 'http://127.0.0.1:1/v1' }],
  agent: { workspace: '/tmp/work', maxTurns: 30, compactAt: 0.8 }, permissions: {}, hooks: {},
  mcp: { servers: { rea: { transport: 'stdio', command: 'fake', enabled: false } } },
  line: { enabled: false, port: 0, slowResponseMs: 45000, allow: { users: [], groups: [], rooms: [] } }, api: { port: 0 },
};
