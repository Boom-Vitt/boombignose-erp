import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const write = (value: unknown) => process.stdout.write(JSON.stringify(value) + '\n');
const lifecycle = process.argv.indexOf('--lifecycle');
if (lifecycle !== -1) appendFileSync(process.argv[lifecycle + 1]!, 'started\n');
if (process.argv.includes('--banner')) process.stdout.write('Fake MCP starting\n');
let pinged = false, initialized = false;
for await (const line of createInterface({ input: process.stdin })) {
  const m = JSON.parse(line);
  if (m.id === 'server-ping' && m.result) { pinged = true; continue; }
  if (m.method === 'notifications/initialized') { initialized = true; continue; }
  if (!m.id) continue;
  const reply = (result: unknown) => write({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') {
    if (process.argv.includes('--delay-init')) await new Promise(resolve => setTimeout(resolve, 300));
    if (m.params.protocolVersion !== '2025-11-25') process.exit(2);
    write({ jsonrpc: '2.0', id: 'server-ping', method: 'ping' });
    write({ jsonrpc: '2.0', method: 'notifications/tools/list_changed' });
    reply({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '1' } });
  } else if (m.method === 'tools/list') {
    if (!initialized || !pinged) { write({ jsonrpc: '2.0', id: m.id, error: { code: -32000, message: 'not initialized' } }); continue; }
    if (m.params?.cursor === 'second') {
      const tools = [{ name: 'fail', description: 'Fail', inputSchema: { type: 'object' } }, { name: 'bad.name', inputSchema: {} }, { name: 'bad/name', inputSchema: {} }, { name: 'x'.repeat(100), inputSchema: {} }];
      reply({ tools: process.argv.includes('--reverse-tools') ? tools.reverse() : tools });
    } else {
      const tools = [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object' } }];
      if (lifecycle !== -1) tools.push(...['wait', 'exit'].map(name => ({ name, description: name, inputSchema: { type: 'object' } })));
      reply({ tools, nextCursor: 'second' });
    }
  } else if (m.method === 'tools/call' && m.params.name === 'echo') {
    reply({ content: [{ type: 'text', text: String(m.params.arguments.text) }, { type: 'text', text: `${process.env.BN_TEST}|${process.env.PATH ? 'path' : 'missing'}` }] });
  } else if (m.method === 'tools/call' && m.params.name === 'fail') {
    reply({ content: [{ type: 'text', text: 'tool failed' }], isError: true });
  } else if (m.method === 'tools/call' && m.params.name === 'wait') {
    // Leave the request pending until the test aborts it or closes the client.
  } else if (m.method === 'tools/call' && m.params.name === 'exit') {
    process.stderr.write(`server ending: ${process.env.BN_TEST}; ${JSON.stringify(process.env.BN_TEST)}\n`, () => {
      if (process.argv.includes('--exit-signal')) process.kill(process.pid, 'SIGTERM');
      else process.exit(3);
    });
  } else if (m.method === 'tools/call' && ['bad.name', 'bad/name', 'x'.repeat(100)].includes(m.params.name)) {
    reply({ content: [{ type: 'text', text: m.params.name }] });
  } else {
    write({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'unknown method or tool' } });
  }
}
