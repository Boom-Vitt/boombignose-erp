// Settings: Skills (folders with SKILL.md).
import type { Api } from '../api.ts';
import type { Skill, SkillSummary } from '../types.ts';
import { btn, confirmBtn, el, field, guarded, load, toast } from '../dom.ts';

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function mountSkills(pane: HTMLElement, api: Api): void {
  const editor = el('div', { class: 'editor' }, el('p', { class: 'muted' }, 'Pick a skill, or create a new one.'));
  const reload = () => void load(pane, () => api.listSkills(), render);

  function openEditor(skill: Skill | null): void {
    const name = el('input', { type: 'text', value: skill?.name ?? '', disabled: !!skill, placeholder: 'my-skill', autocomplete: 'off', spellcheck: 'false' });
    const description = el('input', { type: 'text', value: skill?.description ?? '', placeholder: 'When should BigNose use this skill?', autocomplete: 'off' });
    const body = el('textarea', { class: 'mono', rows: 16, spellcheck: 'false' });
    body.value = skill?.body ?? '';
    const form = el('form', { class: 'card' },
      el('h3', {}, skill ? skill.name : 'New skill'),
      field('Name', name, skill ? undefined : 'Lowercase letters, digits and "-", up to 64 characters.'),
      field('Description', description),
      field('Instructions (Markdown)', body),
      el('div', { class: 'actions' },
        el('button', { type: 'submit', class: 'btn primary' }, 'Save'),
        skill && confirmBtn('Delete', (b) => void guarded(async () => { await api.deleteSkill(skill.name); toast('Deleted'); reload(); }, b))));
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
      }, form.querySelector('button[type=submit]') as HTMLButtonElement);
    });
    editor.replaceChildren(form);
  }

  const listBox = el('ul', { class: 'plain-list' });
  function renderList(skills: SkillSummary[]): void {
    listBox.replaceChildren(...skills.map((s) => el('li', {},
      el('button', { type: 'button', class: 'session', onclick: () => void guarded(async () => openEditor(await api.getSkill(s.name))) },
        el('span', { class: 'session-title' }, s.name), el('span', { class: 'session-sub' }, s.description)))));
    if (!skills.length) listBox.append(el('li', { class: 'muted pad' }, 'No skills yet.'));
  }

  function render({ skills }: { skills: SkillSummary[] }): void {
    renderList(skills);
    pane.append(el('h2', {}, 'Skills'),
      el('p', { class: 'muted' }, 'A skill is a folder with a SKILL.md file. BigNose sees the list and loads one when it fits the task. It can also write skills itself.'),
      el('div', { class: 'split' }, el('div', {}, btn('New skill', () => openEditor(null), 'primary block'), listBox), editor));
  }

  reload();
}
