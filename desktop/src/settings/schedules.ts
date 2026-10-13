// Settings: Schedules (cron jobs).
import type { Api } from '../api.ts';
import type { Delivery, Job } from '../types.ts';
import { badge, btn, check, confirmBtn, el, errMsg, field, formatTime, guarded, select, toast } from '../dom.ts';

export function mountSchedules(pane: HTMLElement, api: Api): void {
  const list = el('div', { class: 'cards' });

  async function refresh(): Promise<void> {
    try {
      const { jobs } = await api.listSchedules();
      list.replaceChildren(...jobs.map(jobCard));
      if (!jobs.length) list.append(el('p', { class: 'muted' }, 'No schedules yet.'));
    } catch (e) {
      list.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refresh())));
    }
  }

  function jobCard(j: Job): HTMLElement {
    const toggle = check('Enabled', j.enabled, (on) => {
      void guarded(() => api.setScheduleEnabled(j.id, on)).then((ok) => { if (!ok) void refresh(); });
    });
    return el('section', { class: 'card' },
      el('div', { class: 'card-head' }, el('code', {}, j.cron), badge(j.delivery.kind === 'line' ? `LINE ${j.delivery.to}` : 'Desktop')),
      el('p', { class: 'note-text' }, j.prompt),
      el('p', { class: 'muted' },
        j.nextRunAt ? `Next run: ${formatTime(j.nextRunAt)}` : 'Not scheduled',
        j.lastRunAt ? ` · Last run: ${formatTime(j.lastRunAt)}${j.lastStatus ? ` (${j.lastStatus})` : ''}` : ''),
      el('div', { class: 'actions' }, toggle.root,
        confirmBtn('Delete', (b) => void guarded(async () => { await api.deleteSchedule(j.id); await refresh(); }, b))));
  }

  const cron = el('input', { type: 'text', placeholder: '0 9 * * 1-5', autocomplete: 'off', spellcheck: 'false', required: true });
  const prompt = el('textarea', { rows: 3, placeholder: 'What should BigNose do?', required: true });
  const delivery = select([['desktop', 'This app'], ['line', 'A LINE chat']], 'desktop');
  const to = el('input', { type: 'text', placeholder: 'U… or C… or R…', autocomplete: 'off', spellcheck: 'false' });
  const toField = field('LINE chat ID', to);
  toField.hidden = true;
  delivery.addEventListener('change', () => { toField.hidden = delivery.value !== 'line'; });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Add schedule');
  const form = el('form', { class: 'card' },
    el('h3', {}, 'Add a schedule'),
    el('div', { class: 'grid2' },
      field('When (cron)', cron, 'Five fields: minute hour day-of-month month day-of-week. Local time.'),
      field('Send the result to', delivery)),
    toField, field('Prompt', prompt), el('div', { class: 'actions' }, submit));
  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void guarded(async () => {
      const expr = cron.value.trim().split(/\s+/).join(' ');
      if (expr.split(' ').length !== 5) throw new Error('A cron expression has five fields');
      if (!prompt.value.trim()) throw new Error('Write a prompt');
      let d: Delivery = { kind: 'desktop' };
      if (delivery.value === 'line') {
        if (!to.value.trim()) throw new Error('Enter the LINE chat ID');
        d = { kind: 'line', to: to.value.trim() };
      }
      await api.addSchedule({ cron: expr, prompt: prompt.value.trim(), delivery: d });
      toast('Schedule added');
      form.reset();
      toField.hidden = true;
      await refresh();
    }, submit);
  });

  pane.append(el('h2', {}, 'Schedules'),
    el('p', { class: 'muted' }, 'Run a prompt on a schedule and send the answer to this app or a LINE chat. Schedules survive restarts; runs missed while BigNose was off are skipped.'),
    list, form);
  void refresh();
}
