import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  deleteSkill, listSkills, loadSkill, parseSkillFile, saveSkill, scanSkills, skillsIndex, skillTools,
} from '../../src/skills/index.ts';
import type { ToolContext } from '../../src/types.ts';

const ctx: ToolContext = { sessionId: 's', origin: { kind: 'desktop' }, cwd: '/', signal: new AbortController().signal, depth: 0 };

function tmpSkills(t: { after(fn: () => void): void }): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return path.join(root, 'skills'); // does not exist yet on purpose
}

function write(dir: string, rel: string, text: string) {
  const file = path.join(dir, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

const skillMd = (name: string, description: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${description}\n---\n\n${body}\n`;

test('frontmatter: plain, quoted, CRLF, comments and unknown lines', () => {
  const p = parseSkillFile('﻿---\r\nname: demo\r\n# a comment\r\ndescription: "Say \\"hi\\": a, b"\r\nlicense: \'it\'\'s MIT\'\r\nmetadata:\r\n  nested: 1\r\n---\r\n\r\n\r\nBody here\r\nline 2\r\n');
  assert.deepEqual(p?.meta, { name: 'demo', description: 'Say "hi": a, b', license: "it's MIT", metadata: '' });
  assert.equal(p?.body, 'Body here\r\nline 2');
  assert.equal(parseSkillFile('no frontmatter'), undefined);
  assert.equal(parseSkillFile('---\nname: x\nnever closed'), undefined);
  assert.deepEqual(parseSkillFile('---\n---\nbody')?.meta, {});
});

for (const marker of ['>', '>-', '>+', '|', '|-', '|+']) {
  test(`frontmatter: ${marker} collects the full block description`, () => {
    const text = `---\r\nname: demo\r\ndescription: ${marker}\r\n\r\n  First line.\r\n  Second line.\r\n\r\nlicense: MIT\r\n---\r\n\r\nBody.\r\n`;
    assert.deepEqual(parseSkillFile(text), {
      meta: { name: 'demo', description: marker.startsWith('>') ? 'First line. Second line.' : 'First line.\nSecond line.', license: 'MIT' },
      body: 'Body.',
    });
  });
}

test('block descriptions load in full and appear on one line in the skills index', (t) => {
  const dir = tmpSkills(t);
  write(dir, 'folded/SKILL.md', skillMd('folded', '>\n  Work with PDFs.\n  Use for documents.'));
  write(dir, 'literal/SKILL.md', skillMd('literal', '|\n  First paragraph.\n\n  Second paragraph.'));
  assert.equal(loadSkill(dir, 'folded')!.description, 'Work with PDFs. Use for documents.');
  assert.equal(loadSkill(dir, 'literal')!.description, 'First paragraph.\n\nSecond paragraph.');
  assert.deepEqual(scanSkills(dir).skipped, []);
  assert.equal(skillsIndex(dir, scanSkills(dir).skills.map(s => s.name)), '- folded: Work with PDFs. Use for documents.\n- literal: First paragraph. Second paragraph.');
});

test('index lists name + description; missing dir is empty', (t) => {
  const dir = tmpSkills(t);
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), []);
  assert.equal(skillsIndex(dir, scanSkills(dir).skills.map(s => s.name)), '');
  write(dir, 'pdf-tools/SKILL.md', skillMd('pdf-tools', 'Work with PDF files. Use when asked about PDFs.'));
  write(dir, 'สรุป-ข่าว/ignored.txt', 'x');
  write(dir, 'daily-brief/SKILL.md', skillMd('daily-brief', '"สรุปข่าวประจำวัน: เช้า"'));
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), [
    { name: 'daily-brief', description: 'สรุปข่าวประจำวัน: เช้า' },
    { name: 'pdf-tools', description: 'Work with PDF files. Use when asked about PDFs.' },
  ]);
  assert.equal(skillsIndex(dir, scanSkills(dir).skills.map(s => s.name)), '- daily-brief: สรุปข่าวประจำวัน: เช้า\n- pdf-tools: Work with PDF files. Use when asked about PDFs.');
});

test('invalid skills are skipped with a reason, never a crash', (t) => {
  const dir = tmpSkills(t);
  write(dir, 'good/SKILL.md', skillMd('good', 'ok'));
  write(dir, 'no-name/SKILL.md', '---\ndescription: has no name\n---\nbody');
  write(dir, 'no-desc/SKILL.md', '---\nname: no-desc\n---\nbody');
  write(dir, 'empty-desc/SKILL.md', '---\nname: empty-desc\ndescription: ""\n---\nbody');
  write(dir, 'wrong-name/SKILL.md', skillMd('other', 'mismatch'));
  write(dir, 'no-fm/SKILL.md', 'just markdown');
  write(dir, 'empty-block/SKILL.md', skillMd('empty-block', '>\n  '));
  write(dir, 'no-file/readme.txt', 'x');
  write(dir, 'Bad_Name/SKILL.md', skillMd('Bad_Name', 'x'));
  write(dir, '.hidden/SKILL.md', skillMd('hidden', 'x'));
  write(dir, 'loose-file.md', 'x');
  write(dir, 'long/SKILL.md', skillMd('long', 'x'.repeat(1025)));

  const { skills, skipped } = scanSkills(dir);
  assert.deepEqual(skills.map((s) => s.name), ['good']);
  const reason = (folder: string) => skipped.find((s) => s.folder === folder)?.reason;
  assert.match(reason('no-name')!, /name is missing/);
  assert.match(reason('no-desc')!, /description is missing/);
  assert.match(reason('empty-desc')!, /description is missing/);
  assert.match(reason('wrong-name')!, /does not match the folder/);
  assert.match(reason('no-fm')!, /frontmatter/);
  assert.match(reason('empty-block')!, /description is missing/);
  assert.match(reason('no-file')!, /SKILL\.md is missing/);
  assert.match(reason('Bad_Name')!, /invalid folder name/);
  assert.match(reason('long')!, /over 1024/);
  assert.equal(reason('.hidden'), undefined);
  assert.equal(skipped.length, 9);
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled).map((s) => s.name), ['good']);
});

test('load returns the body without frontmatter and the folder\'s other files', (t) => {
  const dir = tmpSkills(t);
  write(dir, 'deploy/SKILL.md', skillMd('deploy', 'Deploy the app', '# Deploy\n\n1. Build\n2. Ship'));
  write(dir, 'deploy/scripts/run.sh', 'echo hi');
  write(dir, 'deploy/notes.md', 'notes');
  const s = loadSkill(dir, 'deploy')!;
  assert.equal(s.body, '# Deploy\n\n1. Build\n2. Ship');
  assert.doesNotMatch(s.body, /description:/);
  assert.equal(s.description, 'Deploy the app');
  assert.deepEqual(s.files, ['notes.md', 'scripts/run.sh']);
  assert.equal(s.folder, path.join(dir, 'deploy'));
  assert.equal(loadSkill(dir, 'missing'), undefined);
});

test('load throws for a broken SKILL.md and for invalid names', (t) => {
  const dir = tmpSkills(t);
  write(dir, 'broken/SKILL.md', 'nothing');
  assert.throws(() => loadSkill(dir, 'broken'), /frontmatter is missing/);
  for (const bad of ['../etc', 'a/b', '', 'Upper', '-lead', 'x'.repeat(65), '.', '..']) {
    assert.throws(() => loadSkill(dir, bad), /invalid skill name/, JSON.stringify(bad));
    assert.throws(() => deleteSkill(dir, bad), /invalid skill name/);
    assert.throws(() => saveSkill(dir, { name: bad, description: 'd', body: 'b' }), /invalid skill name/);
  }
});

test('SKILL.md as a symlink is not read', (t) => {
  const dir = tmpSkills(t);
  const secret = path.join(path.dirname(dir), 'secret.md');
  fs.writeFileSync(secret, skillMd('sneaky', 'leaks a file'));
  fs.mkdirSync(path.join(dir, 'sneaky'), { recursive: true });
  fs.symlinkSync(secret, path.join(dir, 'sneaky', 'SKILL.md'));
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), []);
  assert.throws(() => loadSkill(dir, 'sneaky'), /not a regular file/);
});

test('save then load round trip, update in place, delete', (t) => {
  const dir = tmpSkills(t);
  const input = { name: 'thai-notes', description: 'จดบันทึก: "ประชุม" และ \\ backslash', body: '\n\n  indented first line\n\nสวัสดี\n\n' };
  saveSkill(dir, input);
  assert.ok(fs.existsSync(path.join(dir, 'thai-notes', 'SKILL.md')));
  const s = loadSkill(dir, 'thai-notes')!;
  assert.equal(s.description, input.description);
  assert.equal(s.body, '  indented first line\n\nสวัสดี');
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), [{ name: 'thai-notes', description: input.description }]);

  write(dir, 'thai-notes/extra.txt', 'keep me');
  saveSkill(dir, { name: 'thai-notes', description: 'multi\nline  description', body: 'v2' });
  const v2 = loadSkill(dir, 'thai-notes')!;
  assert.equal(v2.description, 'multi line description', 'newlines collapse to one line');
  assert.equal(v2.body, 'v2');
  assert.deepEqual(v2.files, ['extra.txt'], 'other files survive an update');

  assert.equal(deleteSkill(dir, 'thai-notes'), true);
  assert.equal(deleteSkill(dir, 'thai-notes'), false);
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), []);
});

test('load and save refuse a symlinked skill folder, including a dangling link', (t) => {
  const dir = tmpSkills(t);
  const outside = path.join(path.dirname(dir), 'outside');
  write(outside, 'SKILL.md', skillMd('linked', 'outside', 'Keep this body.'));
  fs.mkdirSync(dir);
  fs.symlinkSync(outside, path.join(dir, 'linked'));
  fs.symlinkSync(path.join(outside, 'missing'), path.join(dir, 'dangling'));
  for (const name of ['linked', 'dangling']) {
    assert.throws(() => loadSkill(dir, name), /symlink/i);
    assert.throws(() => saveSkill(dir, { name, description: 'new', body: 'Overwrite.' }), /symlink/i);
  }
  assert.equal(fs.readFileSync(path.join(outside, 'SKILL.md'), 'utf8'), skillMd('linked', 'outside', 'Keep this body.'));
});

test('save cannot overwrite the target of a planted temporary-file symlink', (t) => {
  const dir = tmpSkills(t);
  const outside = path.join(path.dirname(dir), 'outside.txt');
  fs.writeFileSync(outside, 'Keep this text.');
  fs.mkdirSync(path.join(dir, 'safe'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, 'safe', `SKILL.md.${process.pid}.tmp`));
  saveSkill(dir, { name: 'safe', description: 'safe', body: 'New body.' });
  assert.equal(fs.readFileSync(outside, 'utf8'), 'Keep this text.');
  assert.equal(loadSkill(dir, 'safe')!.body, 'New body.');
});

test('an unreadable SKILL.md is skipped without breaking the index', (t) => {
  if (process.getuid?.() === 0) { t.skip('root can read chmod 000 files'); return; }
  const dir = tmpSkills(t);
  write(dir, 'good/SKILL.md', skillMd('good', 'ok'));
  write(dir, 'unreadable/SKILL.md', skillMd('unreadable', 'hidden'));
  const file = path.join(dir, 'unreadable', 'SKILL.md');
  fs.chmodSync(file, 0);
  const { skills, skipped } = scanSkills(dir);
  assert.deepEqual(skills, [{ name: 'good', description: 'ok' }]);
  assert.equal(skipped[0]!.folder, 'unreadable');
  assert.match(skipped[0]!.reason, /read.*SKILL\.md/i);
  assert.deepEqual(listSkills(dir).filter(s => !s.bundled), skills);
  assert.equal(skillsIndex(dir, scanSkills(dir).skills.map(s => s.name)), '- good: ok');
  assert.throws(() => loadSkill(dir, 'unreadable'), /read.*SKILL\.md/i);
});

test('save validates name, description and body', (t) => {
  const dir = tmpSkills(t);
  assert.throws(() => saveSkill(dir, { name: 'ok', description: '  ', body: 'b' }), /description is required/);
  assert.throws(() => saveSkill(dir, { name: 'ok', description: 'x'.repeat(1025), body: 'b' }), /description is over/);
  assert.throws(() => saveSkill(dir, { name: 'ok', description: 'd', body: '  \n ' }), /body is required/);
  assert.throws(() => saveSkill(dir, { name: 'ok', description: 'd', body: 'x'.repeat(200_001) }), /body is over/);
  assert.ok(!fs.existsSync(path.join(dir, 'ok')), 'nothing written on failure');
  saveSkill(dir, { name: 'a', description: 'd', body: 'b' });
  saveSkill(dir, { name: '0-9-z', description: 'd', body: 'b' });
  saveSkill(dir, { name: 'x'.repeat(64), description: 'd', body: 'b' });
});

test('tools: skill_load (allow) and skill_save (ask)', async (t) => {
  const dir = tmpSkills(t);
  const [load, save] = skillTools(dir);
  assert.deepEqual([load!.name, save!.name], ['skill_load', 'skill_save']);
  assert.deepEqual([load!.defaultPolicy, save!.defaultPolicy], ['allow', 'ask']);

  assert.equal((await save!.run({ name: 'greet', description: 'Greets people', body: 'Say hello.' }, ctx)).content, 'Saved skill "greet".');
  write(dir, 'greet/data/names.txt', 'bob');
  const r = await load!.run({ name: 'greet' }, ctx);
  assert.equal(r.isError, undefined);
  assert.match(r.content, /^Say hello\./);
  assert.match(r.content, /Other files in this skill/);
  assert.match(r.content, /- data\/names\.txt/);
  assert.doesNotMatch(r.content, /name: greet/);

  const missing = await load!.run({ name: 'nope' }, ctx);
  assert.equal(missing.isError, true);
  assert.match(missing.content, /Available: greet/);
  assert.equal((await load!.run({ name: '../x' }, ctx)).isError, true);
  assert.equal((await load!.run({}, ctx)).isError, true);
  assert.equal((await save!.run({ name: 'Bad Name', description: 'd', body: 'b' }, ctx)).isError, true);
  assert.equal((await save!.run({ name: 'ok', description: 5, body: 'b' }, ctx)).isError, true);
});
