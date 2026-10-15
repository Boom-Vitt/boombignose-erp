// Settings › Tools › More options › Hooks: shell commands around tool calls. The Tools save bar saves them.
import { btn, el, field } from '../dom.ts';
import type { HookForm, HooksForm } from './forms.ts';
import { row } from './parts.ts';

const EVENTS: { id: keyof HooksForm; label: string; hint: string }[] = [
  { id: 'preTool', label: 'Before a tool', hint: 'A failed command or timeout blocks that tool call.' },
  { id: 'postTool', label: 'After a tool', hint: 'Runs after a tool finishes.' },
  { id: 'sessionEnd', label: 'When a run ends', hint: 'Runs when a top-level agent run ends.' },
];

/** Three lists of hook rows. `onChange` runs after a row is added or removed (typing bubbles as input events). */
export function hooksEditor(values: HooksForm, onChange: () => void): { root: HTMLElement; value(): HooksForm } {
  const readers = EVENTS.map(({ id, label, hint }) => {
    const list = el('div', { class: 'hook-list' });
    const rows: { root: HTMLElement; value(): HookForm }[] = [];

    function add(value: HookForm): void {
      const command = el('textarea', { rows: 2, required: true, spellcheck: 'false', autocomplete: 'off', value: value.command });
      const tools = el('textarea', { rows: 2, spellcheck: 'false', value: value.tools });
      const timeout = el('input', { type: 'number', min: 1, step: 1, value: value.timeoutMs, placeholder: '10000' });
      const root = el('section', { class: 'hook-row rows', 'aria-label': `${label} hook` },
        field('Command', command),
        id !== 'sessionEnd' && field('Tool filter', tools, 'One exact tool name per line; blank matches every tool.'),
        field('Timeout (milliseconds)', timeout, 'Leave blank to use 10000 ms.'),
        el('div', { class: 'row' }, el('span', { class: 'spacer' }), btn('Remove hook', () => { rows.splice(rows.indexOf(item), 1); root.remove(); onChange(); }, 'danger small')));
      const item = { root, value: () => ({ command: command.value, tools: tools.value, timeoutMs: timeout.value }) };
      rows.push(item);
      list.append(root);
    }

    for (const value of values[id]) add(value);
    return {
      id, root: el('div', { class: 'hooks-event' }, row(label, hint, btn('Add hook', () => { add({ command: '', tools: '', timeoutMs: '' }); onChange(); }, 'small')), list),
      value: () => rows.map((r) => r.value()),
    };
  });
  return {
    root: el('div', {}, ...readers.map((r) => r.root)),
    value: () => Object.fromEntries(readers.map((r) => [r.id, r.value()])) as unknown as HooksForm,
  };
}
