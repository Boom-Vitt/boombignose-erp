// Two deterministic REA tools; no package downloads, filesystem access or network.
import { createInterface } from 'node:readline';
const tools = ['open_binary', 'analyze_javascript_application'];
for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) continue;
  let result: unknown;
  if (message.method === 'initialize') result = { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake-rea', version: '1' } };
  else if (message.method === 'tools/list') result = { tools: tools.map(name => ({ name, description: name, inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] } })) };
  else if (message.method === 'tools/call' && tools.includes(message.params.name)) result = { content: [{ type: 'text', text: `${message.params.name}: fixture evidence <script>unsafe()</script>` }] };
  else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Unknown method' } }) + '\n'); continue; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }) + '\n');
}
