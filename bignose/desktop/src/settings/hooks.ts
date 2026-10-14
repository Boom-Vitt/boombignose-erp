import type { Api } from '../api.ts';
import type { Settings } from '../types.ts';
import { btn, el, field, guarded, load, toast } from '../dom.ts';
import { hooksFromConfig, hooksToConfig } from './forms.ts';
import type { HookForm, HooksForm } from './forms.ts';

const EVENTS: { id: keyof HooksForm; label: string; hint: string }[] = [
  { id: 'preTool', label: 'Pre-tool', hint: 'Runs before a tool. A failed command or timeout blocks that tool call.' },
  { id: 'postTool', label: 'Post-tool', hint: 'Runs after a tool finishes.' },
  { id: 'sessionEnd', label: 'Session end', hint: 'Runs when a top-level agent run ends.' },
];

export function mountHooks(pane: HTMLElement, api: Api): void {
  const reload = () => void load(pane, () => api.getSettings(), render);

  function render({ config }: Settings): void {
    const values = hooksFromConfig(config);
    const form = el('form');
    const readers = EVENTS.map(({ id, label, hint }) => {
      const list = el('div', { class: 'hook-list' });
      const rows: { root: HTMLElement; value(): HookForm }[] = [];

      function add(value: HookForm): void {
        const command = el('textarea', { rows: 2, required: true, spellcheck: 'false', autocomplete: 'off', value: value.command });
        const tools = el('textarea', { rows: 2, spellcheck: 'false', value: value.tools });
        const timeout = el('input', { type: 'number', min: 1, step: 1, value: value.timeoutMs, placeholder: '10000' });
        const root = el('section', { class: 'hook-row', 'aria-label': `${label} hook` },
          field('Command', command),
          id !== 'sessionEnd' && field('Tool filter', tools, 'One exact tool name per line; blank matches every tool.'),
          field('Timeout (milliseconds)', timeout, 'Leave blank to use 10000 ms.'),
          btn('Remove hook', () => { rows.splice(rows.indexOf(row), 1); root.remove(); }, 'danger small'));
        const row = { root, value: () => ({ command: command.value, tools: tools.value, timeoutMs: timeout.value }) };
        rows.push(row);
        list.append(root);
      }

      for (const value of values[id]) add(value);
      form.append(el('section', { class: 'card' }, el('h3', {}, label), el('p', { class: 'muted' }, hint), list,
        el('div', { class: 'actions' }, btn('Add hook', () => add({ command: '', tools: '', timeoutMs: '' })))));
      return { id, value: () => rows.map((row) => row.value()) };
    });
    const save = el('button', { type: 'submit', class: 'btn primary' }, 'Save');
    form.append(el('div', { class: 'actions' }, save));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value: HooksForm = { preTool: [], postTool: [], sessionEnd: [] };
      for (const reader of readers) value[reader.id] = reader.value();
      void guarded(async () => {
        await api.updateSettings((c) => { c.hooks = hooksToConfig(c, value).hooks; });
        toast('Saved');
        reload();
      }, save);
    });
    pane.append(el('h2', {}, 'Hooks'), el('p', { class: 'muted' }, 'Shell commands run in order with event details as JSON on standard input.'), form);
  }

  reload();
}
