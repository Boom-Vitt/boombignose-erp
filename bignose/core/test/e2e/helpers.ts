import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import type { TestContext } from 'node:test';
import { defaultConfig, saveConfig } from '../../src/config.ts';
import type { Config } from '../../src/types.ts';

export function testHome(t: TestContext): string {
  const home = mkdtempSync(join(tmpdir(), 'bn-'));
  process.env.BIGNOSE_TEST_PORTS = '0';
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return home;
}
export const cliFile = new URL('../../src/cli.ts', import.meta.url);
export async function cli(home: string, args: string[], timeout = 30_000) {
  try {
    const r = await promisify(execFile)(process.execPath, [cliFile.pathname, ...args], { env: { ...process.env, BIGNOSE_HOME: home }, timeout, maxBuffer: 1024 * 1024 });
    return { code: 0, ...r };
  } catch (e) {
    const error = e as Error & { code: number; stdout: string; stderr: string };
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}
export async function mockOpenai(t: TestContext, answer: (request: any, call: number) => Record<string, unknown> | Promise<Record<string, unknown>>) {
  const requests: any[] = [];
  const server = createServer(async (req, res) => {
    try {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const request = JSON.parse(raw); requests.push(request);
      const delta = await answer(request, requests.length);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }] })}\n\ndata: [DONE]\n\n`);
    } catch (e) { res.writeHead(500); res.end(String(e)); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); }));
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  return { baseUrl, requests };
}
export function configured(home: string, baseUrl = 'http://127.0.0.1:1/v1', change?: (c: Config) => void): Config {
  const config = defaultConfig();
  config.providers = [{ id: 'mock', kind: 'openai-compatible', baseUrl }];
  config.active = { provider: 'mock', model: 'test-model' };
  config.api.port = 0; config.line.port = 0; config.agent.workspace = home;
  change?.(config); saveConfig(config, home); return config;
}
export const toolCall = (name: string, input: Record<string, unknown>, id = 'call-1') => ({ tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(input) } }] });
