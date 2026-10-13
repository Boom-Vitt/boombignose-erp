import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import type { SkillInfo } from '../skills/index.ts';

export interface Command { name: string; description: string; usage: string; kind: 'builtin' | 'skill' }
export interface SlashExpansion { command: string; skills: string[]; connectors: string[]; prompt: string; target?: string }
export class CommandError extends Error {
  status: number;
  connector?: string;
  constructor(message: string, status = 400, connector?: string) { super(message); this.status = status; this.connector = connector; }
}
const rea: Command = { name: 'rea', description: 'Reverse engineer an app or file with REA.', usage: '/rea <app or file path>', kind: 'builtin' };

export function listCommands(skills: SkillInfo[]): Command[] {
  return [rea, ...skills.filter(s => s.name !== rea.name).map(s => ({ name: s.name, description: s.description, usage: `/${s.name} [request]`, kind: 'skill' as const }))];
}

export function expandSlash(text: string, skills: SkillInfo[], { cwd }: { cwd: string }): SlashExpansion | { error: string } | null {
  const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(text);
  if (!match || !listCommands(skills).some(c => c.name === match[1])) return null;
  const name = match[1]!, request = (match[2] ?? '').trim();
  if (name !== 'rea') return { command: name, skills: [name], connectors: [], prompt: request || `Use the ${name} skill.` };
  let path = request;
  if ((path.startsWith('"') && path.endsWith('"')) || (path.startsWith("'") && path.endsWith("'"))) path = path.slice(1, -1);
  if (!path.trim()) return { error: `usage: ${rea.usage}` };
  if (path === '~' || path.startsWith('~/')) path = homedir() + path.slice(1);
  const target = resolve(cwd, path);
  if (!existsSync(target)) return { error: `not found: ${target}` };
  return { command: name, skills: ['reverse-engineer-anything'], connectors: ['rea'], target,
    prompt: `Reverse engineer the target ${JSON.stringify(target)}. Write a Markdown report with evidence (tool and location for each claim). Cover the app type, process/bundle layout (for Electron: main / preload / renderer), IPC channels, screens and routes (including Messaging → LINE), the local API it calls, and what is unknown. The REA tools are already connected; do not run REA setup, doctor or npx commands.` };
}
