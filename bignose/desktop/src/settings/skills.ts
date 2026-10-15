// Settings › Tools › Skills (folders with SKILL.md). The Tools tab opens this as its own view.
import type { Api } from '../api.ts';
import type { Skill, SkillSummary } from '../types.ts';
import { btn, confirmDialog, el, field, guarded, load, toast } from '../dom.ts';
import { row } from './parts.ts';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function mountSkills(pane: HTMLElement, api: Api): void {
  const editor = el('div', { class: 'editor' }, el('p', { class: 'muted' }, 'Pick a skill, or create a new one.'));
  const reload = () => void load(pane, () => api.listSkills(), render);

  function openEditor(skill: Skill | null): void {
    const name = el('input', { type: 'text', value: skill?.name ?? '', disabled: !!skill, placeholder: 'my-skill', autocomplete: 'off', spellcheck: 'false' });
    const description = el('input', { type: 'text', value: skill?.description ?? '', placeholder: 'When should BigNose use this skill?', autocomplete: 'off' });
    const body = el('textarea', { class: 'mono', rows: 16, spellcheck: 'false' });
    body.value = skill?.body ?? '';
    const save = el('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const form = el('form', { class: 'card' },
      el('h3', { class: 'card-title' }, skill ? skill.name : 'New skill'),
      field('Name', name, skill ? undefined : 'Lowercase letters, digits and "-", up to 64 characters.'),
      field('Description', description),
      field('Instructions (Markdown)', body),
      el('div', { class: 'row' }, el('span', { class: 'spacer' }),
        skill && btn('Delete…', () => void (async () => {
          if (!await confirmDialog({ title: `Delete ${skill.name}?`, body: 'The skill folder is removed from this Mac.', action: 'Delete' })) return;
          await guarded(async () => { await api.deleteSkill(skill.name); toast('Deleted'); reload(); });
        })(), 'danger'),
        save));
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void guarded(async () => {
        const n = name.value.trim();
        if (!NAME_RE.test(n)) throw new Error('Name: lowercase letters, digits and "-", starting with a letter or digit');
        if (!description.value.trim()) throw new Error('Enter a description');
        await api.putSkill(n, { description: description.value.trim(), body: body.value }, !skill); // New skill: a taken name is refused, not replaced
        toast('Saved');
        const list = await api.listSkills();
        renderList(list.skills);
        openEditor({ name: n, description: description.value.trim(), body: body.value });
      }, save);
    });
    editor.replaceChildren(form);
  }

  const listBox = el('div', { class: 'card skill-list' });
  function renderList(skills: SkillSummary[]): void {
    listBox.replaceChildren(...skills.map((s) => el('button', { type: 'button', class: 'row skill-pick', onclick: () => void guarded(async () => openEditor(await api.getSkill(s.name))) },
      el('span', { class: 'row-text' }, el('span', { class: 'skill-name' }, s.name), el('span', { class: 'row-sub' }, s.description)))));
    if (!skills.length) listBox.append(row('No skills yet.', null));
  }

  function render({ skills }: { skills: SkillSummary[] }): void {
    renderList(skills);
    pane.append(
      el('div', { class: 'page-sub' }, el('span', {}, 'A skill is a folder with a SKILL.md file. BigNose sees the list and loads one when it fits the task. It can also write skills itself.'), btn('New skill', () => openEditor(null), 'small')),
      el('div', { class: 'split' }, listBox, editor));
  }

  reload();
}
