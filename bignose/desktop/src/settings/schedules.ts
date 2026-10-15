// Settings › Schedules: prompts BigNose runs on a timetable, one row each, and the plain "When" form for a new one.
import type { Api } from '../api.ts';
import type { Agent, Delivery, Job, Settings } from '../types.ts';
import { btn, confirmDialog, el, errMsg, field, formatTime, guarded, load, select, th, toast } from '../dom.ts';
import { cronFor, describeCron } from './forms.ts';
import type { When } from './forms.ts';
import { agentSelect, menuHost, moreMenu, saveBar, shortId, sw } from './parts.ts';

const WHEN: [When, string][] = [['day', 'Every day'], ['weekdays', 'Weekdays'], ['week', 'Every week'], ['hour', 'Every hour'], ['custom', 'Custom (cron)']];
const WEEKDAYS: [string, string][] = [['1', 'Monday'], ['2', 'Tuesday'], ['3', 'Wednesday'], ['4', 'Thursday'], ['5', 'Friday'], ['6', 'Saturday'], ['0', 'Sunday']];
const OTHER = '__other'; // value of "Other LINE chat…" in Send the answer to

/** `agent` presets the filter and the new schedule's agent (the roster's "N schedules" link). */
export function mountSchedules(pane: HTMLElement, api: Api, agent?: string): void {
  menuHost(pane);
  const fetchData = async () => {
    const [{ agents }, settings, { jobs }] = await Promise.all([api.listAgents(), api.getSettings(), api.listSchedules(agent)]);
    return { agents, settings, jobs };
  };
  const reload = () => void load(pane, fetchData, render);

  function render({ agents, settings, jobs: first }: { agents: Agent[]; settings: Settings; jobs: Job[] }): void {
    const filterAgent = agents.find((a) => a.id === agent);
    const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name ?? id ?? 'Shared';
    const list = el('div', { class: 'card schedules' });
    let seq = 0;

    async function refresh(): Promise<void> {
      const mine = ++seq;
      try {
        const { jobs } = await api.listSchedules(filterAgent?.id);
        if (mine !== seq) return;
        list.replaceChildren(...jobs.map(jobRow));
        if (!jobs.length) list.append(el('div', { class: 'row empty-row' }, filterAgent ? 'No schedules for this agent yet.' : 'No schedules yet. Add one and BigNose runs it on time.'));
      } catch (e) {
        if (mine !== seq) return;
        list.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refresh())));
      }
    }

    function jobRow(j: Job): HTMLElement {
      const toggle = sw('Enabled', j.enabled);
      toggle.addEventListener('change', () => {
        void guarded(() => api.setScheduleEnabled(j.id, toggle.checked), toggle).then((ok) => { if (!ok) void refresh(); });
      });
      const parts: (Node | string)[] = [describeCron(j.cron), agentName(j.agentId)];
      if (j.delivery.kind === 'line') parts.push(`to LINE ${shortId(j.delivery.to)}`);
      if (j.nextRunAt) parts.push(`next ${formatTime(j.nextRunAt)}`);
      if (j.lastStatus?.startsWith('error')) parts.push(el('span', { class: 'status bad' }, 'Last run failed'));
      const sub = el('div', { class: 'row-sub' });
      parts.forEach((p, i) => { if (i) sub.append(' · '); sub.append(p); });
      return el('div', { class: 'row' },
        el('div', { class: 'row-text' }, el('div', { class: 'note-text', lang: th(j.prompt) }, j.prompt), sub),
        toggle,
        moreMenu('More for this schedule', [['Delete…', () => void remove(j), true]]));
    }
    async function remove(j: Job): Promise<void> {
      const text = j.prompt.length > 80 ? `${j.prompt.slice(0, 79)}…` : j.prompt;
      if (!await confirmDialog({ title: 'Delete this schedule?', body: text, action: 'Delete' })) return;
      await guarded(async () => { await api.deleteSchedule(j.id); await refresh(); });
    }

    // ---- New schedule: a plain "When" (cron stays behind Custom)
    const prompt = el('textarea', { rows: 3, placeholder: 'What should BigNose do?', required: true });
    const newAgent = agentSelect(agents, filterAgent?.id ?? agents[0]?.id ?? '');
    const when = select(WHEN, 'day');
    const time = el('input', { type: 'time', value: '09:00', 'aria-label': 'Time' });
    const weekday = select(WEEKDAYS, '1');
    weekday.setAttribute('aria-label', 'Day of the week');
    when.setAttribute('aria-label', 'How often');
    const cron = el('input', { type: 'text', placeholder: '0 9 * * 1-5', autocomplete: 'off', spellcheck: 'false' });
    const cronField = field('Cron expression', cron, 'Five fields: minute hour day-of-month month day-of-week. Local time.');
    const allowed = Object.values(settings.config.line.allow).flat();
    const sendTo = select([['desktop', 'This app'], ...allowed.map((id): [string, string] => [id, `LINE ${shortId(id)}`]), [OTHER, 'Other LINE chat…']], 'desktop');
    const other = el('input', { type: 'text', placeholder: 'U… or C… or R…', autocomplete: 'off', spellcheck: 'false', 'aria-label': 'LINE chat ID' });
    const otherField = field('LINE chat ID', other, 'Approvals only work in allowed chats.');
    const summary = () => {
      try { return describeCron(cronFor(when.value as When, time.value, weekday.value, cron.value)); } catch { return 'Pick a time'; }
    };
    function showWhen(): void {
      time.hidden = when.value === 'hour' || when.value === 'custom';
      weekday.hidden = when.value !== 'week';
      cronField.hidden = when.value !== 'custom';
      otherField.hidden = sendTo.value !== OTHER;
      bar.show(el('strong', {}, summary()), ` · ${agentName(newAgent.value)}`);
    }
    const bar = saveBar(() => { form.hidden = true; }, { action: 'Add schedule', cancel: 'Cancel' });
    const form = el('form', { hidden: true },
      el('div', { class: 'card' }, field('What to do', prompt), field('Agent', newAgent),
        field('When', el('span', { class: 'when' }, when, weekday, time)), cronField,
        field('Send the answer to', sendTo), otherField),
      bar.root);
    for (const control of [when, weekday, time, cron, sendTo, newAgent]) { control.addEventListener('change', showWhen); control.addEventListener('input', showWhen); }
    showWhen();
    bar.root.hidden = false;
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void guarded(async () => {
        const expr = cronFor(when.value as When, time.value, weekday.value, cron.value);
        if (expr.split(' ').length !== 5) throw new Error('A cron expression has five fields');
        if (!prompt.value.trim()) throw new Error('Write what BigNose should do');
        let d: Delivery = { kind: 'desktop' };
        if (sendTo.value !== 'desktop') {
          const to = sendTo.value === OTHER ? other.value.trim() : sendTo.value;
          if (!to) throw new Error('Enter the LINE chat ID');
          if (!(await api.lineStatus()).running) throw new Error('LINE is off. Turn it on under Settings › LINE before you schedule a LINE delivery.');
          d = { kind: 'line', to };
        }
        await api.addSchedule({ cron: expr, prompt: prompt.value.trim(), delivery: d, agentId: newAgent.value });
        toast('Schedule added');
        prompt.value = ''; form.hidden = true;
        await refresh();
      }, bar.submit);
    });

    pane.append(el('div', { class: 'page-stack' },
      el('div', { class: 'page-sub' }, el('span', {}, 'Run a prompt on a timetable and send the answer to this app or a LINE chat. Runs missed while BigNose was off are skipped.'),
        btn('Add schedule', () => { form.hidden = !form.hidden; if (!form.hidden) prompt.focus(); }, 'small')),
      ...(filterAgent ? [el('div', { class: 'page-sub filter-note' }, el('span', {}, 'Showing schedules for ', el('strong', { lang: th(filterAgent.name) }, filterAgent.name), '.'),
        btn('Show all', () => { window.location.hash = '#/settings/schedules'; }, 'quiet small'))] : []),
      form, list));
    list.replaceChildren(...first.map(jobRow));
    if (!first.length) list.append(el('div', { class: 'row empty-row' }, filterAgent ? 'No schedules for this agent yet.' : 'No schedules yet. Add one and BigNose runs it on time.'));
  }

  reload();
}
