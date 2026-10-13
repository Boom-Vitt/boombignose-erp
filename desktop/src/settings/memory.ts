// Settings: Memory (notes the agent keeps).
import type { Api } from '../api.ts';
import type { MemoryKind, MemoryNote } from '../types.ts';
import { badge, btn, confirmBtn, el, errMsg, field, formatTime, guarded, select, toast } from '../dom.ts';

export function mountMemory(pane: HTMLElement, api: Api): void {
  const kind = select([['', 'All notes'], ['user', 'About you'], ['agent', "BigNose's notes"]], '');
  const query = el('input', { type: 'search', placeholder: 'Search notes', autocomplete: 'off' });
  const list = el('div', { class: 'cards' });

  async function refresh(): Promise<void> {
    try {
      const { notes } = await api.listMemory((kind.value || undefined) as MemoryKind | undefined, query.value.trim() || undefined);
      list.replaceChildren(...notes.map(noteCard));
      if (!notes.length) list.append(el('p', { class: 'muted' }, 'No notes.'));
    } catch (e) {
      list.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refresh())));
    }
  }

  function noteCard(n: MemoryNote): HTMLElement {
    const text = el('p', { class: 'note-text' }, n.text);
    const card = el('section', { class: 'card' });
    const actions = el('div', { class: 'actions' });
    const showView = () => {
      actions.replaceChildren(
        btn('Edit', showEdit, 'small'),
        confirmBtn('Delete', (b) => void guarded(async () => { await api.deleteMemory(n.id); await refresh(); }, b), 'small'));
      card.replaceChildren(el('div', { class: 'card-head' }, badge(n.kind === 'user' ? 'About you' : "BigNose's note"), el('span', { class: 'muted' }, formatTime(n.updatedAt))), text, actions);
    };
    const showEdit = () => {
      const box = el('textarea', { rows: 4, 'aria-label': 'Note text' });
      box.value = n.text;
      card.replaceChildren(box, el('div', { class: 'actions' },
        btn('Save', (b) => void guarded(async () => {
          if (!box.value.trim()) throw new Error('A note cannot be empty');
          await api.updateMemory(n.id, box.value.trim());
          await refresh();
        }, b), 'primary'),
        btn('Cancel', showView)));
      box.focus();
    };
    showView();
    return card;
  }

  const newKind = select([['user', 'About you'], ['agent', "BigNose's notes"]], 'user');
  const newText = el('textarea', { rows: 3, placeholder: 'For example: I prefer short answers in Thai.' });
  const add = el('form', { class: 'card' },
    el('h3', {}, 'Add a note'),
    el('div', { class: 'grid2' }, field('Type', newKind)),
    field('Note', newText),
    el('div', { class: 'actions' }, el('button', { type: 'submit', class: 'btn primary' }, 'Add')));
  add.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void guarded(async () => {
      if (!newText.value.trim()) throw new Error('Write a note first');
      await api.addMemory(newKind.value as MemoryKind, newText.value.trim());
      newText.value = '';
      toast('Added');
      await refresh();
    }, add.querySelector('button[type=submit]') as HTMLButtonElement);
  });

  let timer = 0;
  query.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 250); });
  kind.addEventListener('change', () => void refresh());

  pane.append(el('h2', {}, 'Memory'),
    el('p', { class: 'muted' }, 'Notes BigNose keeps between chats. It reads them at the start of every run.'),
    el('div', { class: 'toolbar' }, field('Show', kind), field('Search', query)), list, add);
  void refresh();
}
