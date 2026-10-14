import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { TestContext } from 'node:test';
import { createProvider } from '../../src/providers/index.ts';
import { McpClient } from '../../src/mcp/client.ts';
import { collect, request } from '../providers/helpers.ts';

async function listen(server: Server, t: TestContext): Promise<string> {
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  return `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}
test('provider and MCP POST/DELETE redirects cannot forward credentials to another origin', async t => {
  let forwarded = 0, deleteSeen = false;
  const target = await listen(createServer((req, res) => { forwarded++; req.resume(); res.end('{}'); }), t);
  let initialize = false;
  const source = await listen(createServer(async (req, res) => {
    if (req.method === 'DELETE') deleteSeen = true;
    if (initialize && req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const m = JSON.parse(raw);
      res.writeHead(m.method === 'initialize' ? 200 : 202, { 'Content-Type': 'application/json', 'Mcp-Session-Id': 'test-session' });
      res.end(m.method === 'initialize' ? JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2025-11-25' } }) : '');
    } else { req.resume(); res.writeHead(307, { Location: target }); res.end(); }
  }), t);
  for (const kind of ['anthropic', 'openai-compatible'] as const) {
    const provider = createProvider({ id: 'mock', kind, baseUrl: source }, 'test-key');
    await assert.rejects(collect(provider.stream(request)), /fetch failed|redirect/i);
  }
  const client = new McpClient({ transport: 'http', url: source, headers: { 'X-Private': 'test-key' }, enabled: true });
  t.after(() => client.close());
  await assert.rejects(client.connect(), /fetch failed|redirect/i);
  initialize = true; await client.connect(); await client.close();
  assert.equal(deleteSeen, true); assert.equal(forwarded, 0);
});
