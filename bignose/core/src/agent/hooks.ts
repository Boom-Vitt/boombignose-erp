import type { HookSpec, ToolResult } from '../types.ts';
import { runCommand } from '../tools/process.ts';
export interface HookPayload { event: 'preTool' | 'postTool' | 'sessionEnd'; sessionId: string; tool?: string; input?: Record<string, unknown>; output?: string; isError?: boolean; status?: string }
export async function runHooks(hooks: HookSpec[] | undefined, payload: HookPayload, signal?: AbortSignal): Promise<ToolResult | undefined> {
  for (const hook of hooks ?? []) {
    if (hook.tools?.length && (!payload.tool || !hook.tools.includes(payload.tool))) continue;
    const result = await runCommand(hook.command, { signal, timeoutMs: hook.timeoutMs ?? 10_000,
      input: JSON.stringify(payload), env: { ...process.env, BIGNOSE_HOOK_EVENT: payload.event } });
    if (payload.event === 'preTool' && (result.code !== 0 || result.reason)) {
      return { content: `blocked by hook: ${result.stderr.split(/\r?\n/)[0] || result.reason || `exit ${result.code}`}`, isError: true };
    }
  }
  return undefined;
}
