// Settings › Memory: the notes BigNose keeps between chats, one row each.
import type { Api } from '../api.ts';
import type { Agent, MemoryKind, MemoryNote } from '../types.ts';
import { btn, confirmDialog, el, errMsg, field, formatTime, guarded, load, select, th, toast } from '../dom.ts';
import { agentSelect, menuHost, moreMenu } from './parts.ts';

export function mountMemory(pane: HTMLElement, api: Api): void {
  menuHost(pane);
  void load(pane, async () => {
    const [{ agents }, { notes }] = await Promise.all([api.listAgents(), api.listMemory()]);
    return { agents, notes };
  }, render);

  function render({ agents, notes: first }: { agents: Agent[]; notes: MemoryNote[] }): void {
    const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? 'Shared';
    const kind = select([['', 'All notes'], ['user', 'About you'], ['agent', "BigNose's notes"]], '');
    const query = el('input', { type: 'search', placeholder: 'Search notes', autocomplete: 'off' });
    const agentFilter = agentSelect(agents, '', 'All agents');
    // filters only earn their place with a long list; once shown they stay, so a narrow search cannot hide them
    const filters = el('div', { class: 'toolbar', hidden: first.length <= 10 }, field('Agent', agentFilter), field('Show', kind), field('Search', query));
    const list = el('div', { class: 'card notes' });
    let seq = 0;

    async function refresh(): Promise<void> {
      const mine = ++seq;
      try {
        const filtered = Boolean(kind.value || query.value.trim() || agentFilter.value);
        const { notes } = await api.listMemory((kind.value || undefined) as MemoryKind | undefined, query.value.trim() || undefined, agentFilter.value || undefined);
        if (mine !== seq) return;
        if (!filtered && notes.length > 10) filters.hidden = false;
        list.replaceChildren(...notes.map(noteRow));
        if (!notes.length) list.append(el('div', { class: 'row empty-row' }, filtered ? 'No notes match.' : 'No notes yet. BigNose saves what it learns about you here.'));
      } catch (e) {
        if (mine !== seq) return;
        list.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refresh())));
      }
    }

    function noteRow(n: MemoryNote): HTMLElement {
      const item = el('div', { class: 'note' });
      const view = () => item.replaceChildren(el('div', { class: 'row' },
        el('div', { class: 'row-text' }, el('div', { class: 'note-text', lang: th(n.text) }, n.text),
          el('div', { class: 'row-sub' }, `${n.kind === 'user' ? 'About you' : agentName(n.agentId)} · ${formatTime(n.updatedAt)}`)),
        moreMenu('More for this note', [['Edit…', edit], ['Delete…', () => void remove(), true]])));
      async function remove(): Promise<void> {
        const preview = n.text.length > 80 ? `${n.text.slice(0, 79)}…` : n.text;
        if (!await confirmDialog({ title: 'Delete this note?', body: preview, action: 'Delete' })) return;
        await guarded(async () => { await api.deleteMemory(n.id); await refresh(); });
      }
      function edit(): void {
        const box = el('textarea', { rows: 4, 'aria-label': 'Note text' });
        box.value = n.text;
        setLang(box);
        item.replaceChildren(el('div', { class: 'field' }, box), el('div', { class: 'row' }, el('span', { class: 'spacer' }),
          btn('Cancel', view, 'quiet'),
          btn('Save', (b) => void guarded(async () => {
            if (!box.value.trim()) throw new Error('A note cannot be empty');
            await api.updateMemory(n.id, box.value.trim());
            await refresh();
          }, b), 'primary')));
        box.focus();
      }
      view();
      return item;
    }
    const setLang = (box: HTMLTextAreaElement) => { const lang = th(box.value); if (lang) box.setAttribute('lang', lang); };

    // ---- Add note
    const newKind = select([['user', 'About you'], ['agent', "BigNose's notes"]], 'user');
    const newAgent = agentSelect(agents, agents[0]?.id ?? '');
    const agentField = field('Agent for agent notes', newAgent);
    agentField.hidden = true;
    const newText = el('textarea', { rows: 3, placeholder: 'For example: I prefer short answers in Thai.' });
    newKind.addEventListener('change', () => { agentField.hidden = newKind.value !== 'agent'; });
    const add = el('form', { class: 'card', hidden: true }, field('Type', newKind), agentField, field('Note', newText),
      el('div', { class: 'row' }, el('span', { class: 'spacer' }), btn('Cancel', () => { add.hidden = true; }, 'quiet'),
        el('button', { type: 'submit', class: 'btn primary' }, 'Add note')));
    add.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void guarded(async () => {
        if (!newText.value.trim()) throw new Error('Write a note first');
        await api.addMemory(newKind.value as MemoryKind, newText.value.trim(), newKind.value === 'agent' ? newAgent.value : undefined);
        newText.value = ''; add.hidden = true;
        toast('Added');
        await refresh();
      }, add.querySelector('button[type=submit]') as HTMLButtonElement);
    });

    let timer = 0;
    query.addEventListener('input', () => { window.clearTimeout(timer); timer = window.setTimeout(() => void refresh(), 250); });
    kind.addEventListener('change', () => void refresh());
    agentFilter.addEventListener('change', () => void refresh());

    pane.append(el('div', { class: 'page-stack' },
      el('div', { class: 'page-sub' }, el('span', {}, 'Notes BigNose keeps between chats. It reads them at the start of every run.'), btn('Add note', () => { add.hidden = !add.hidden; if (!add.hidden) newText.focus(); }, 'small')),
      add, filters, list));
    list.replaceChildren(...first.map(noteRow));
    if (!first.length) list.append(el('div', { class: 'row empty-row' }, 'No notes yet. BigNose saves what it learns about you here.'));
  }
}
