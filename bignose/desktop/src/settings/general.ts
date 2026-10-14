import type { Api } from '../api.ts';
import type { Settings } from '../types.ts';
import { btn, el, errMsg, field, guarded, load, toast } from '../dom.ts';
import { generalFromConfig, generalToConfig } from './forms.ts';

export function mountGeneral(pane: HTMLElement, api: Api): void {
  const reload = () => void load(pane, () => api.getSettings(), render);

  function render({ config }: Settings): void {
    const values = generalFromConfig(config);
    const workspace = el('input', { type: 'text', value: values.workspace, required: true, spellcheck: 'false', autocomplete: 'off' });
    const maxTurns = el('input', { type: 'number', value: values.maxTurns, required: true, min: 1, step: 1 });
    const compactAt = el('input', { type: 'number', value: values.compactAt, required: true, min: 0, max: 1, step: 'any' });
    const save = el('button', { type: 'submit', class: 'btn primary' }, 'Save');
    const form = el('form', { class: 'card' },
      field('Agent workspace folder', workspace, 'Folder used by the agent for file and shell tools.'),
      el('div', { class: 'grid2' },
        field('Max turns', maxTurns, 'Maximum model calls in a run.'),
        field('Compaction threshold', compactAt, 'Fraction of the context window: greater than 0 and at most 1 (for example 0.8).')),
      el('div', { class: 'actions' }, save));
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const value = { workspace: workspace.value, maxTurns: maxTurns.value, compactAt: compactAt.value };
      void guarded(async () => {
        await api.updateSettings((c) => { c.agent = generalToConfig(c, value).agent; });
        toast('Saved');
        reload();
      }, save);
    });
    const result = el('div', { 'aria-live': 'polite' });
    const run = btn('Run diagnostics', runDiagnostics);
    function runDiagnostics(): void {
      if (run.disabled) return;
      void guarded(async () => {
        result.replaceChildren(el('p', { class: 'muted' }, 'Running diagnostics…'));
        try {
          const { code, lines } = await api.doctor();
          result.replaceChildren(
            el('p', { class: `result ${code === 0 ? 'ok' : 'bad'}` }, code === 0 ? 'All checks passed' : 'Some checks failed'),
            el('pre', { class: 'code' }, lines.join('\n')));
        } catch (e) {
          result.replaceChildren(el('div', { class: 'notice error', role: 'alert' },
            el('p', {}, errMsg(e)), btn('Retry', runDiagnostics)));
        }
      }, run);
    }
    pane.append(el('h2', {}, 'General'), el('p', { class: 'muted' }, 'Workspace and limits for agent runs.'), form,
      el('section', { class: 'card' }, el('h3', {}, 'Diagnostics'), el('div', { class: 'actions' }, run), result));
  }

  reload();
}
