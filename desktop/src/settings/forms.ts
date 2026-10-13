// Pure General / Hooks form conversions; the rest of the fresh config stays intact.
import type { Config, HookSpec } from '../types.ts';

export interface GeneralForm { workspace: string; maxTurns: string; compactAt: string }
export interface HookForm { command: string; tools: string; timeoutMs: string }
export type HooksForm = { preTool: HookForm[]; postTool: HookForm[]; sessionEnd: HookForm[] };

function positiveInteger(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${label} must be a positive whole number`);
  return n;
}

export function generalFromConfig(config: Config): GeneralForm {
  const { workspace, maxTurns, compactAt } = config.agent;
  return { workspace, maxTurns: String(maxTurns), compactAt: String(compactAt) };
}

export function generalToConfig(config: Config, form: GeneralForm): Config {
  const workspace = form.workspace.trim();
  if (!workspace) throw new Error('Enter an agent workspace folder');
  const maxTurns = positiveInteger(form.maxTurns, 'Max turns');
  const compactAt = Number(form.compactAt);
  if (!Number.isFinite(compactAt) || compactAt <= 0 || compactAt > 1) {
    throw new Error('Compaction threshold must be greater than 0 and at most 1');
  }
  return { ...config, agent: { ...config.agent, workspace, maxTurns, compactAt } };
}

export function hooksFromConfig(config: Config): HooksForm {
  const rows = (hooks: HookSpec[] = []): HookForm[] => hooks.map((h) => ({
    command: h.command, tools: (h.tools ?? []).join('\n'), timeoutMs: h.timeoutMs === undefined ? '' : String(h.timeoutMs),
  }));
  return { preTool: rows(config.hooks.preTool), postTool: rows(config.hooks.postTool), sessionEnd: rows(config.hooks.sessionEnd) };
}

export function hooksToConfig(config: Config, form: HooksForm): Config {
  const rows = (entries: HookForm[], toolHook: boolean): HookSpec[] => entries.map((entry) => {
    const command = entry.command.trim();
    if (!command) throw new Error('Enter a command for each hook, or remove the empty hook');
    const hook: HookSpec = { command };
    const tools = entry.tools.split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
    if (toolHook && tools.length) hook.tools = tools;
    if (entry.timeoutMs.trim()) hook.timeoutMs = positiveInteger(entry.timeoutMs, 'Hook timeout');
    return hook;
  });
  return { ...config, hooks: {
    ...config.hooks,
    preTool: rows(form.preTool, true), postTool: rows(form.postTool, true), sessionEnd: rows(form.sessionEnd, false),
  } };
}
