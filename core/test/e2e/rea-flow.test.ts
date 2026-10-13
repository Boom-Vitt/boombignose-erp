import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, existsSync, lstatSync, openSync, readFileSync, readSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { startDaemon } from '../../src/app/daemon.ts';
import type { ApiEvent } from '../../src/app/runtime.ts';
import type { JsonSchema, ToolResultBlock } from '../../src/types.ts';
import { configured, mockOpenai, testHome, toolCall } from './helpers.ts';

const target = resolve(process.env.BIGNOSE_REA_TARGET ?? join(homedir(), '.hermes/hermes-agent/apps/desktop/release/mac-arm64/Hermes.app/Contents/Resources/app.asar'));

function targetArgs(schema: JsonSchema, path: string): Record<string, unknown> {
  const field = ['path', 'input_path'].find(name => schema.properties?.[name]?.type === 'string');
  assert.ok(field, 'REA must list a target path input');
  const args = { [field]: path };
  for (const name of schema.required ?? []) assert.ok(name in args, `unexpected required REA input: ${name}`);
  return args;
}

function verifiedJavaScriptScope(): string {
  const entryPath = 'dist/node_modules/node-pty/lib/shared/conout.js';
  const file = join(target + '.unpacked', entryPath), scope = dirname(file);
  const fd = openSync(target, 'r');
  try {
    const prefix = Buffer.alloc(16);
    assert.equal(readSync(fd, prefix, 0, prefix.length, 0), prefix.length);
    const size = prefix.readUInt32LE(12);
    assert.ok(size > 0 && size <= 16 * 1024 * 1024, 'bounded ASAR header');
    const bytes = Buffer.alloc(size);
    assert.equal(readSync(fd, bytes, 0, size, 16), size);
    let entry = JSON.parse(bytes.toString('utf8'));
    for (const part of entryPath.split('/')) entry = entry?.files?.[part];
    assert.equal(entry?.unpacked, true, 'JS scope must be an unpacked entry of this ASAR');
    assert.equal(entry.integrity?.algorithm, 'SHA256');
    assert.ok(lstatSync(file).isFile(), 'JS entry must be a regular file');
    assert.deepEqual(readdirSync(scope), ['conout.js'], 'verify every file in the selected scope');
    assert.equal(createHash('sha256').update(readFileSync(file)).digest('hex'), entry.integrity.hash, 'shipped JS must match the ASAR header');
    return scope;
  } finally { closeSync(fd); }
}

test('real REA opens Hermes Desktop and analyzes its shipped JavaScript through /rea with persisted evidence and a report', {
  skip: process.env.BIGNOSE_SKIP_NETWORK === '1' ? 'BIGNOSE_SKIP_NETWORK=1' : !existsSync(target) ? 'REA target is missing' : false,
  timeout: 240_000,
}, async t => {
  const home = testHome(t), scope = verifiedJavaScriptScope();
  const mock = await mockOpenai(t, (req, n) => {
    const names = ['mcp__rea__open_binary', 'mcp__rea__analyze_javascript_application'];
    if (n <= 2) {
      const tool = req.tools.find((tool: any) => tool.function.name === names[n - 1]);
      assert.ok(tool, `missing real REA tool ${names[n - 1]}`);
      const args = targetArgs(tool.function.parameters, n === 1 ? target : scope);
      if (n === 2) {
        assert.ok(tool.function.parameters.properties.format.enum.includes('directory'));
        args.format = 'directory';
      }
      return toolCall(tool.function.name, args, `rea-${n}`);
    }
    assert.equal(n, 3);
    const results = req.messages.filter((m: any) => m.role === 'tool');
    assert.equal(results.length, 2); for (const result of results) assert.ok(result.content.trim().length > 0);
    const analysis = JSON.parse(results[1].content).result;
    assert.ok(analysis.statistics.parsed_javascript_files > 0);
    assert.ok(analysis.graph.nodes.length > 0);
    return { content: `# Hermes Desktop\nPartial static evidence: open_binary opened ${target}; analyze_javascript_application parsed ${analysis.statistics.parsed_javascript_files} JavaScript file and recovered ${analysis.graph.nodes.length} graph nodes at ${scope}.\nUnknown: the main/preload/renderer layout, IPC channels, routes, local API and runtime behavior are outside this scoped check. Whole-ASAR analysis refuses the mismatching unpacked pty.node.` };
  });
  configured(home, mock.baseUrl, c => { c.mcp.servers.rea!.enabled = true; c.agent.maxTurns = 5; c.providers[0]!.contextWindow = 10_000_000; });
  const a = await startDaemon({ home }); t.after(() => a.close());
  const agent = a.runtime.store.createAgent({ name: 'Hermes Reverser', provider: 'mock', model: 'test-model', connectors: ['rea'], permissions: { 'mcp__rea__*': 'allow' } });
  const session = a.runtime.store.createSession({ agentId: agent.id, origin: { kind: 'desktop' } });
  const events: ApiEvent[] = []; a.runtime.subscribe(e => events.push(e));
  const run = a.runtime.start(session.id, `/rea ${target}`);
  const result = await run.result;
  assert.equal(result.status, 'done', result.error);
  const messages = a.runtime.store.getMessages(session.id), blocks = messages.flatMap(m => m.content);
  const tools = blocks.filter((b): b is ToolResultBlock => b.type === 'tool_result');
  assert.deepEqual(tools.map(r => r.toolUseId), ['rea-1', 'rea-2']);
  for (const tool of tools) {
    assert.equal(tool.isError, false, `${tool.toolUseId}: ${tool.content.slice(0, 2000)}`); assert.ok(tool.content.trim().length > 0);
    const evidence = JSON.parse(tool.content);
    assert.equal(evidence.error, undefined, tool.content.slice(0, 2000));
    assert.notEqual(evidence.success, false, tool.content.slice(0, 2000));
  }
  const analysis = JSON.parse(tools[1]!.content).result;
  assert.equal(analysis.input_path, scope); assert.ok(analysis.statistics.parsed_javascript_files > 0);
  assert.deepEqual(blocks.filter(b => b.type === 'tool_use').map(b => b.name), ['mcp__rea__open_binary', 'mcp__rea__analyze_javascript_application']);
  assert.deepEqual(messages[0]!.content, [{ type: 'text', text: `/rea ${target}` }]);
  const files = readdirSync(join(home, 'reports')); assert.equal(files.length, 1);
  assert.match(readFileSync(join(home, 'reports', files[0]!), 'utf8'), /# Hermes Desktop/);
  assert.ok(events.some(e => e.type === 'notification' && e.title === 'Report saved' && e.sessionId === session.id));
});
