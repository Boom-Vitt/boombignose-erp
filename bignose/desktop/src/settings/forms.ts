// Settings form logic: config conversions (the rest of the fresh config stays intact) and the save bar's wording.
import { el } from '../dom.ts';
import type { Config, HookSpec, Policy } from '../types.ts';

export interface GeneralForm { workspace: string; maxTurns: string; compactAt: string }
export interface HookForm { command: string; tools: string; timeoutMs: string }
export type HooksForm = { preTool: HookForm[]; postTool: HookForm[]; sessionEnd: HookForm[] };

function positiveInteger(value: string, label: string): number {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 1) throw new Error(`${label} must be a positive whole number`);
  return n;
}

/** What the Tools tab and the daemon both require of a changed workspace; the daemon also checks that the folder exists. */
export function checkWorkspace(value: string): string {
  const folder = value.trim();
  if (!folder) throw new Error('Enter an agent workspace folder');
  if (!(folder === '~' || folder.startsWith('~/') || folder.startsWith('/'))) throw new Error('The workspace folder must be a full path like /Users/you/Projects, or start with ~/');
  return folder;
}

export function generalFromConfig(config: Config): GeneralForm {
  const { workspace, maxTurns, compactAt } = config.agent;
  return { workspace, maxTurns: String(maxTurns), compactAt: String(compactAt) };
}

/** The two limits on a run, validated; the Model tab saves these without touching the workspace. */
export function checkLimits(form: { maxTurns: string; compactAt: string }): { maxTurns: number; compactAt: number } {
  const maxTurns = positiveInteger(form.maxTurns, 'Max turns');
  const compactAt = Number(form.compactAt);
  if (!Number.isFinite(compactAt) || compactAt <= 0 || compactAt > 1) {
    throw new Error('Compaction threshold must be greater than 0 and at most 1');
  }
  return { maxTurns, compactAt };
}

export function generalToConfig(config: Config, form: GeneralForm): Config {
  const workspace = checkWorkspace(form.workspace);
  return { ...config, agent: { ...config.agent, workspace, ...checkLimits(form) } };
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

/** One value that differs from the saved one. A secret or a hidden value never carries its text. */
export interface Change { label: string; from?: string; to?: string; secret?: boolean }

/** The labels whose value differs between two snapshots of a form. */
export function dirty(initial: Record<string, string>, now: Record<string, string>, o: { secret?: string[]; hidden?: string[] } = {}): Change[] {
  return Object.keys(initial).filter((k) => initial[k] !== now[k]).map((label) => {
    if (o.secret?.includes(label)) return { label, secret: true };
    return o.hidden?.includes(label) ? { label } : { label, from: initial[label], to: now[label] };
  });
}

/** The save bar's words: "Model changed from a to b", "Model and Context window changed", "Model and 2 more changed", "API key replaced". */
export function changeText(changes: Change[], note = ''): (Node | string)[] {
  const bold = (c: Change) => el('strong', {}, c.label);
  const [a, b] = changes as [Change, Change?];
  const short = (v?: string) => v !== undefined && v !== '' && v.length <= 24 && !v.includes('\n');
  const words: (Node | string)[] = changes.length === 1
    ? a.secret ? [bold(a), ' replaced'] : short(a.from) && short(a.to) ? [bold(a), ` changed from ${a.from} to ${a.to}`] : [bold(a), ' changed']
    : changes.length === 2 ? [bold(a), ' and ', bold(b!), ' changed'] : [bold(a), ` and ${changes.length - 1} more changed`];
  return note ? [...words, note] : words;
}

/** Allow / Ask / Never, as the Tools tab words them. */
export const POLICIES: [Policy, string][] = [['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Never']];
/** The four plain groups of tools, and what each tool does when no rule names it (the core's built-in defaults). */
export const GROUPS: [label: string, tools: string[]][] = [
  ['Read files', ['read_file', 'list_files', 'search_files']], ['Change files', ['write_file', 'edit_file']],
  ['Run commands', ['shell']], ['Open web pages', ['web_fetch']],
];
export const DEFAULT_POLICY: Record<string, Policy> = { read_file: 'allow', list_files: 'allow', search_files: 'allow', write_file: 'ask', edit_file: 'ask', shell: 'ask', web_fetch: 'ask' };

export type When = 'day' | 'weekdays' | 'week' | 'hour' | 'custom';
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** The five-field cron a "When" choice stands for ("Weekdays" at 09:00 is `0 9 * * 1-5`). `weekday` is 0 (Sunday) to 6. */
export function cronFor(when: When, time: string, weekday: string, custom: string): string {
  if (when === 'custom') return custom.trim().split(/\s+/).join(' ');
  if (when === 'hour') return '0 * * * *';
  const t = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!t) throw new Error('Pick a time');
  const at = `${Number(t[2])} ${Number(t[1])}`;
  return when === 'day' ? `${at} * * *` : when === 'weekdays' ? `${at} * * 1-5` : `${at} * * ${weekday}`;
}

/** "Every day at 08:00", "Weekdays at 09:00", "Every Monday at 07:30", "Every hour"; any other cron is shown as it is. */
export function describeCron(cron: string): string {
  const text = cron.trim(), m = /^(\d{1,2}) (\d{1,2}) \* \* (\*|1-5|[0-6])$/.exec(text);
  if (m) {
    const at = `${m[2]!.padStart(2, '0')}:${m[1]!.padStart(2, '0')}`;
    return m[3] === '*' ? `Every day at ${at}` : m[3] === '1-5' ? `Weekdays at ${at}` : `Every ${DAYS[Number(m[3])]} at ${at}`;
  }
  return text === '0 * * * *' ? 'Every hour' : text;
}
