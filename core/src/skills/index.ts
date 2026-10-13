// Skills: <dir>/<name>/SKILL.md (agentskills.io): tiny YAML frontmatter (name, description) + a Markdown body.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, relative } from 'node:path';
import type { Tool, ToolResult } from '../types.ts';

export interface SkillInfo { name: string; description: string }
export interface LoadedSkill extends SkillInfo { body: string; folder: string; files: string[] }

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_DESCRIPTION = 1024;
const MAX_BODY = 200_000;
const MAX_FILES = 200;

// The "---" fence must be the first line; a body starting with blank lines is normalised so save → load round trips.
const FRONTMATTER_RE = /^\uFEFF?---[ \t]*\r?\n(?:([\s\S]*?)\r?\n)?---[ \t]*(?:\r?\n|$)/;
const normBody = (s: string) => s.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();

/** Frontmatter subset: plain/quoted values and folded (>) or literal (|) blocks. Other lines are ignored. */
export function parseSkillFile(text: string): { meta: Record<string, string>; body: string } | undefined {
  const m = FRONTMATTER_RE.exec(text);
  if (!m) return undefined;
  const meta: Record<string, string> = {};
  const lines = (m[1] ?? '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = /^([A-Za-z0-9_-]+)[ \t]*:[ \t]*(.*)$/.exec(lines[i]!);
    if (!kv) continue;
    let v = kv[2]!.trim();
    if (/^[>|][+-]?$/.test(v)) {
      const block: string[] = [];
      while (i + 1 < lines.length && /^(?:[ \t]|$)/.test(lines[i + 1]!)) block.push(lines[++i]!.trim());
      v = (v.startsWith('>') ? block.filter(Boolean).join(' ') : block.join('\n')).trim();
    } else if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) {
      try { v = JSON.parse(v) as string; } catch { v = v.slice(1, -1); }
    } else if (v.length >= 2 && v.startsWith("'") && v.endsWith("'")) {
      v = v.slice(1, -1).replaceAll("''", "'");
    }
    meta[kv[1]!] = v;
  }
  return { meta, body: normBody(text.slice(m[0].length)) };
}

type Read = { ok: true; name: string; description: string; body: string } | { ok: false; reason: string };

function folderOf(dir: string, name: string): string {
  if (!NAME_RE.test(name)) throw new Error(`invalid skill name "${name}" (lowercase letters, digits and "-", max 64, starting with a letter or digit)`);
  return join(dir, name);
}

function folderExists(folder: string): boolean {
  let st;
  try { st = lstatSync(folder); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
  if (st.isSymbolicLink()) throw new Error(`skill folder "${folder}" must not be a symlink`);
  if (!st.isDirectory()) throw new Error(`skill folder "${folder}" is not a directory`);
  return true;
}

function readSkill(dir: string, name: string): Read {
  const file = join(dir, name, 'SKILL.md');
  let st;
  try { st = lstatSync(file); } catch { return { ok: false, reason: 'SKILL.md is missing' }; }
  if (!st.isFile()) return { ok: false, reason: 'SKILL.md is not a regular file' };
  let parsed;
  try { parsed = parseSkillFile(readFileSync(file, 'utf8')); } catch (e) {
    return { ok: false, reason: `cannot read SKILL.md: ${(e as NodeJS.ErrnoException).code ?? 'read failed'}` };
  }
  if (!parsed) return { ok: false, reason: 'frontmatter is missing' };
  const { name: fmName, description } = parsed.meta;
  if (!fmName) return { ok: false, reason: 'name is missing' };
  if (fmName !== name) return { ok: false, reason: `name "${fmName}" does not match the folder "${name}"` };
  if (!description) return { ok: false, reason: 'description is missing' };
  if (description.length > MAX_DESCRIPTION) return { ok: false, reason: `description is over ${MAX_DESCRIPTION} characters` };
  return { ok: true, name, description, body: parsed.body };
}

/** Valid skills plus the folders that were skipped, each with a reason. A missing dir is just empty. */
export function scanSkills(dir: string): { skills: SkillInfo[]; skipped: { folder: string; reason: string }[] } {
  const skills: SkillInfo[] = [], skipped: { folder: string; reason: string }[] = [];
  if (!existsSync(dir)) return { skills, skipped };
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue; // loose files, symlinked folders, dot folders
    const r = NAME_RE.test(e.name) ? readSkill(dir, e.name) : { ok: false as const, reason: 'invalid folder name' };
    if (r.ok) skills.push({ name: r.name, description: r.description });
    else skipped.push({ folder: e.name, reason: r.reason });
  }
  return { skills, skipped };
}

export const listSkills = (dir: string): SkillInfo[] => scanSkills(dir).skills;

/** undefined when there is no such skill folder; throws for an invalid name or a broken SKILL.md. */
export function loadSkill(dir: string, name: string): LoadedSkill | undefined {
  const folder = folderOf(dir, name);
  if (!folderExists(folder)) return undefined;
  const r = readSkill(dir, name);
  if (!r.ok) throw new Error(`skill "${name}": ${r.reason}`);
  const files = readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => relative(folder, join(e.parentPath, e.name)).split('\\').join('/'))
    .filter((f) => f !== 'SKILL.md')
    .sort()
    .slice(0, MAX_FILES);
  return { name, description: r.description, body: r.body, folder, files };
}

export function saveSkill(dir: string, skill: { name: string; description: string; body: string }): void {
  const folder = folderOf(dir, skill.name);
  const description = skill.description.replace(/\s+/g, ' ').trim();
  if (!description) throw new Error('description is required');
  if (description.length > MAX_DESCRIPTION) throw new Error(`description is over ${MAX_DESCRIPTION} characters`);
  const body = normBody(skill.body);
  if (!body) throw new Error('body is required');
  if (body.length > MAX_BODY) throw new Error(`body is over ${MAX_BODY} characters`);
  folderExists(folder); // refuses existing symlinks before mkdir can follow them
  mkdirSync(folder, { recursive: true });
  const file = join(folder, 'SKILL.md'), tmp = `${file}.${randomUUID()}.tmp`;
  writeFileSync(tmp, `---\nname: ${skill.name}\ndescription: ${JSON.stringify(description)}\n---\n\n${body}\n`, { flag: 'wx' });
  try { renameSync(tmp, file); } finally { rmSync(tmp, { force: true }); } // replaces a symlinked SKILL.md instead of writing through it
}

export function deleteSkill(dir: string, name: string): boolean {
  const folder = folderOf(dir, name);
  if (!existsSync(folder)) return false;
  rmSync(folder, { recursive: true });
  return true;
}

/** One line per skill for the system prompt; '' when there are none. */
export function skillsIndex(dir: string, allowed: string[] | null = null): string {
  return listSkills(dir)
    .filter(s => allowed === null || allowed.includes(s.name))
    .map((s) => {
      const description = s.description.replace(/\s+/g, ' ');
      return `- ${s.name}: ${description.length > 300 ? `${description.slice(0, 299)}…` : description}`;
    })
    .join('\n');
}

const fail = (e: unknown): ToolResult => ({ content: e instanceof Error ? e.message : String(e), isError: true });

export function skillTools(dir: string, allowed: string[] | null = null): Tool[] {
  const load: Tool = {
    name: 'skill_load',
    description: 'Load a skill by name: returns its instructions and lists the other files in its folder (read them with read_file).',
    inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Skill name from the skills index' } }, required: ['name'] },
    defaultPolicy: 'allow',
    async run(input) {
      try {
        const name = typeof input.name === 'string' ? input.name.trim() : '';
        if (allowed !== null && !allowed.includes(name)) return fail(`Skill "${name}" is not enabled for this agent.`);
        const skill = loadSkill(dir, name);
        if (!skill) return fail(`No skill named "${name}". Available: ${listSkills(dir).filter(s => allowed === null || allowed.includes(s.name)).map((s) => s.name).join(', ') || 'none'}`);
        const files = skill.files.length ? `\n\n---\nOther files in this skill (folder ${skill.folder}):\n${skill.files.map((f) => `- ${f}`).join('\n')}` : '';
        return { content: skill.body + files };
      } catch (e) { return fail(e); }
    },
  };
  const save: Tool = {
    name: 'skill_save',
    description: 'Create or replace a skill: a reusable procedure you can load later. Name: lowercase letters, digits and "-". '
      + 'Description: one line saying what it does and when to use it. Body: Markdown instructions.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        body: { type: 'string', description: 'Markdown instructions' },
      },
      required: ['name', 'description', 'body'],
    },
    defaultPolicy: 'ask',
    async run(input) {
      try {
        const { name, description, body } = input;
        if (typeof name !== 'string' || typeof description !== 'string' || typeof body !== 'string') throw new Error('name, description and body must be strings');
        if (allowed !== null && !allowed.includes(name)) return fail(`Skill "${name}" is not enabled for this agent.`);
        saveSkill(dir, { name, description, body });
        return { content: `Saved skill "${name}".` };
      } catch (e) { return fail(e); }
    },
  };
  return [load, save];
}
