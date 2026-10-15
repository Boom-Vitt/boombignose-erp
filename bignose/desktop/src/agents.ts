// Agents: the roster is one card of rows; the form is its own page (#/agents/new and #/agents/<id>).
import type { Api } from './api.ts';
import type { Agent, AgentInput, ModelInfo, Policy } from './types.ts';
import { modelField } from './models.ts';
import { avatar, badge, btn, check, confirmDialog, el, field, guarded, icon, load, select, setLang, th, toast } from './dom.ts';

type Changed = (agentId?: string) => void;
const go = (hash: string) => { window.location.hash = hash; };
const BOT = '\u{1F916}'; // the default icon the API gives new agents

/** The first line of the instructions is what the agent is for. */
const mission = (a: Agent): string => {
  const line = a.instructions.split('\n').map((s) => s.trim()).find(Boolean);
  return !line ? 'General assistant' : line.length > 80 ? `${line.slice(0, 79)}…` : line;
};

export function mountAgents(pane: HTMLElement, api: Api, changed: Changed): void {
  const fetchData = async () => {
    const [agents, settings, schedules] = await Promise.all([api.listAgents(), api.getSettings(), api.listSchedules()]);
    return { ...agents, ...settings, ...schedules };
  };
  const reload = () => void load(pane, fetchData, render);
  // one ⋯ menu is open at a time; a press anywhere else on the page closes it (no focus tricks: WebKit does not focus clicked buttons)
  let closeMenu = () => {};
  let menuWrap: HTMLElement | null = null;
  pane.onpointerdown = (ev) => { if (menuWrap && !menuWrap.contains(ev.target as Node)) closeMenu(); };

  function render({ agents, config, jobs }: Awaited<ReturnType<typeof fetchData>>): void {
    const lineId = config.line.enabled ? (agents.find((a) => a.id === config.line.agentId) ?? agents[0])?.id : undefined;
    const schedules = (id: string) => jobs.filter((j) => j.agentId === id).length;

    async function remove(a: Agent): Promise<void> {
      const n = schedules(a.id), other = agents.find((x) => x.id !== a.id);
      const gone = n ? `Its chats, its notes and its ${n} schedule${n === 1 ? '' : 's'} are deleted too.` : 'Its chats and its notes are deleted too.';
      const line = lineId === a.id && other ? ` LINE will be answered by ${other.name}.` : '';
      if (!await confirmDialog({ title: `Delete ${a.name}?`, body: gone + line, action: 'Delete' })) return;
      await guarded(async () => { await api.deleteAgent(a.id); changed(); reload(); });
    }

    function row(a: Agent): HTMLElement {
      const last = agents.length < 2;
      const item = (label: string, run: (b: HTMLButtonElement) => void, cls = '', disabled = false) => {
        const b = el('button', { type: 'button', role: 'menuitem', tabindex: -1, class: `menu-item ${cls}`.trim(), disabled }, label);
        b.addEventListener('click', () => { closeMenu(); run(b); });
        return b;
      };
      const items = [
        item('Edit…', () => go(`#/agents/${encodeURIComponent(a.id)}`)),
        item('Duplicate', (b) => void guarded(async () => {
          const { id, createdAt, updatedAt, ...copy } = await api.getAgent(a.id);
          await api.createAgent({ ...copy, name: `${copy.name.slice(0, 59)} copy` });
          changed(); reload();
        }, b)),
        item('Delete…', () => void remove(a), 'danger', last),
      ];
      const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': `Actions for ${a.name}`, hidden: true },
        items[0], items[1], el('div', { class: 'menu-sep', role: 'separator' }), items[2], last && el('div', { class: 'menu-note' }, 'BigNose needs at least one agent.'));
      const more = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `More for ${a.name}`, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
      const wrap = el('div', { class: 'agent-actions' },
        el('button', { type: 'button', class: 'btn agent-chat', onclick: () => { changed(a.id); go('#/chat'); } }, 'Chat'), more, menu);
      const close = (refocus = false) => {
        menu.hidden = true; more.setAttribute('aria-expanded', 'false'); menuWrap = null;
        if (refocus) more.focus();
      };
      const open = () => {
        closeMenu(); closeMenu = close; menuWrap = wrap;
        menu.hidden = false; more.setAttribute('aria-expanded', 'true');
        items.find((i) => !i.disabled)?.focus();
      };
      more.addEventListener('click', () => (menu.hidden ? open() : close(true)));
      more.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowDown') { ev.preventDefault(); if (menu.hidden) open(); } });
      menu.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
        if (ev.key === 'Tab') { close(); return; } // the items are not tab stops, so Tab leaves the row
        if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
        ev.preventDefault();
        const live = items.filter((i) => !i.disabled);
        const next = live.indexOf(document.activeElement as HTMLButtonElement) + (ev.key === 'ArrowDown' ? 1 : -1);
        live[(next + live.length) % live.length]?.focus();
      });

      const n = schedules(a.id), text = mission(a);
      return el('div', { class: 'agent-row', 'data-agent-id': a.id },
        avatar(a),
        el('div', {},
          el('div', { class: 'agent-name' }, el('span', { lang: th(a.name) }, a.name), a.id === lineId && badge('Answers LINE', 'ok')),
          el('div', { class: 'agent-mission', lang: th(text) }, text),
          el('div', { class: 'agent-meta' }, a.provider === config.active.provider ? a.model : `${a.provider} · ${a.model}`,
            n > 0 && ' · ', n > 0 && el('a', { href: `#/settings/schedules?agent=${encodeURIComponent(a.id)}` }, `${n} schedule${n === 1 ? '' : 's'}`))),
        wrap);
    }

    pane.append(
      el('div', { class: 'page-head' },
        el('div', {}, el('h1', {}, 'Agents'), el('p', {}, 'Each agent has its own instructions, model and chats.')),
        el('button', { type: 'button', class: 'btn primary', onclick: () => go('#/agents/new') }, icon('plus'), 'New agent')),
      el('div', { class: 'card' }, ...agents.map(row)),
      el('p', { class: 'group-foot' }, 'Pick who you chat with at the top of the sidebar. One agent answers LINE; change it in Settings › LINE.'));
  }
  reload();
}

const SAME = 'same', OTHER = 'other', PICK = 'm:'; // values of the Model select; a listed model is PICK + its id
const POLICIES: [Policy, string][] = [['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Never']];
const GROUPS: [string, string[]][] = [
  ['Read files', ['read_file', 'list_files', 'search_files']], ['Change files', ['write_file', 'edit_file']],
  ['Run commands', ['shell']], ['Open web pages', ['web_fetch']],
];
const strong = (t: string) => el('strong', {}, t);

/** "Name changed", "Name and Icon changed", "Name and 2 more changed". */
function changeText(labels: string[]): (Node | string)[] {
  const [first, second] = labels as [string, string?];
  return labels.length === 1 ? [strong(first), ' changed'] : labels.length === 2 ? [strong(first), ' and ', strong(second!), ' changed'] : [strong(first), ` and ${labels.length - 1} more changed`];
}

/** `id` is an agent to edit, or undefined to create one. */
export function mountAgentForm(pane: HTMLElement, api: Api, id: string | undefined, changed: Changed): void {
  const fetchData = async () => {
    const [agents, settings, mcp, skills] = await Promise.all([api.listAgents(), api.getSettings(), api.listMcp(), api.listSkills()]);
    const agent = agents.agents.find((a) => a.id === id);
    if (id !== undefined && !agent) throw new Error('That agent no longer exists.');
    return { agent, config: settings.config, servers: mcp.servers, skills: skills.skills };
  };
  const body = el('div');
  pane.replaceChildren(el('a', { href: '#/agents', class: 'back' }, icon('chev-r'), 'Agents'), body);
  void load(body, fetchData, render);

  function render(data: Awaited<ReturnType<typeof fetchData>>): void {
    const { agent: a, config, servers, skills } = data;
    const name = el('input', { type: 'text', value: a?.name ?? '', maxlength: 64, required: true });
    const glyph = el('input', { type: 'text', value: a && a.icon !== BOT ? a.icon : '', maxlength: 16 });
    const preview = el('span', { class: 'avatar-slot' }, avatar({ icon: glyph.value }));
    glyph.addEventListener('input', () => preview.replaceChildren(avatar({ icon: glyph.value })));
    const instructions = el('textarea', { rows: 6, value: a?.instructions ?? '' });
    for (const input of [name, instructions]) { setLang(input, input.value); input.addEventListener('input', () => setLang(input, input.value)); }

    // Model: "Same as Settings", a model the provider lists, or Other… (a provider and a typed name). A typed name keeps the datalist.
    const provider = select(config.providers.map((p) => [p.id, p.label || p.id]), a?.provider ?? config.active.provider);
    const model = el('input', { type: 'text', value: a?.model ?? config.active.model });
    const options = (models: ModelInfo[]): [string, string][] =>
      [[SAME, `Same as Settings (${config.active.model})`], ...models.map((m): [string, string] => [PICK + m.id, m.label ?? m.id]), [OTHER, 'Other…']];
    const choice = select(options([]), !a || (a.provider === config.active.provider && a.model === config.active.model) ? SAME : OTHER);
    let touched = false;
    const listed = (models: ModelInfo[]) => {
      const keep = choice.value;
      choice.replaceChildren(...options(models).map(([v, l]) => el('option', { value: v }, l)));
      const flip = !touched && keep === OTHER && models.some((m) => m.id === model.value);
      choice.value = flip ? PICK + model.value : keep;
      if (flip) showOther();
    };
    const modelName = modelField(api, provider, model, 'agent-models', 'Model name', listed);
    const providerRow = field('Provider', provider);
    const showOther = () => { providerRow.hidden = modelName.hidden = choice.value !== OTHER; };
    showOther();
    choice.addEventListener('change', () => { touched = true; showOther(); });
    provider.addEventListener('change', () => { touched = true; });
    const target = () => choice.value === SAME ? { ...config.active }
      : { provider: provider.value, model: choice.value === OTHER ? model.value.trim() : choice.value.slice(PICK.length) };

    const maxTokens = el('input', { type: 'number', min: 1, max: 1000000, step: 1, value: String(a?.maxTokens ?? ''), 'aria-describedby': 'agent-max-tokens-error' });
    const tokensError = el('div', { id: 'agent-max-tokens-error', class: 'notice error', role: 'alert', hidden: true });
    const tokensField = field('Longest answer', maxTokens, 'Tokens. Leave blank: thinking models like qwen3 need room to think first.');
    tokensField.append(tokensError);
    function validateTokens(): boolean {
      const n = Number(maxTokens.value);
      const valid = !maxTokens.validity.badInput && (maxTokens.value === '' || (Number.isInteger(n) && n >= 1 && n <= 1000000));
      tokensError.textContent = valid ? '' : 'Longest answer must be a whole number between 1 and 1000000';
      tokensError.hidden = valid;
      maxTokens.setAttribute('aria-invalid', String(!valid));
      return valid;
    }
    maxTokens.addEventListener('input', validateTokens);
    maxTokens.addEventListener('invalid', validateTokens);

    function choices(label: string, names: string[], selected: string[] | null) {
      const all = check('All', selected === null);
      const picks = [...new Set([...names, ...(selected ?? [])])].map((n) => ({ name: n, ...check(n, selected?.includes(n) ?? false) }));
      const list = el('div', { class: 'agent-picks', hidden: all.input.checked }, ...picks.map((p) => p.root));
      all.input.addEventListener('change', () => { list.hidden = all.input.checked; });
      return { root: el('fieldset', {}, el('legend', {}, label), all.root, list),
        value: () => all.input.checked ? null : picks.filter((p) => p.input.checked).map((p) => p.name) };
    }
    const connectors = choices('Connectors', servers.map((s) => s.name), a?.connectors ?? null);
    const allowedSkills = choices('Skills', skills.map((s) => s.name), a?.skills ?? null);

    // What it may do: four plain groups (Allow / Ask / Never) for the common tools, and one rule per tool for everything else.
    const known = new Set(GROUPS.flatMap(([, tools]) => tools));
    const groupPolicy: Record<string, Policy> = {};
    for (const [tool, policy] of Object.entries(a?.permissions ?? {})) if (known.has(tool)) groupPolicy[tool] = policy;
    const rows: { root: HTMLElement; name: HTMLInputElement; policy: HTMLSelectElement }[] = [];
    const rules = el('div', { class: 'agent-rules' });
    const addPermission = (tool = '', policy: Policy = 'ask') => {
      const toolName = el('input', { type: 'text', value: tool, placeholder: 'shell or mcp__rea__*', 'aria-label': 'Tool name or prefix' });
      const choose = select([['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Deny']], policy);
      choose.setAttribute('aria-label', 'Tool permission');
      const root = el('div', { class: 'kv' }, toolName, choose, btn('Remove', () => {
        rows.splice(rows.findIndex((r) => r.root === root), 1); root.remove(); refresh();
      }, 'small'));
      rows.push({ root, name: toolName, policy: choose }); rules.append(root);
    };
    Object.entries(a?.permissions ?? {}).filter(([tool]) => !known.has(tool)).forEach(([tool, policy]) => addPermission(tool, policy));
    const groupRows = GROUPS.map(([label, tools]) => {
      const sub = el('div', { class: 'row-sub' });
      const segs = POLICIES.map(([policy, text]) => {
        const b = el('button', { type: 'button', 'aria-pressed': 'false' }, text);
        b.addEventListener('click', () => {
          const on = tools.every((t) => groupPolicy[t] === policy); // pressing the pressed one hands the tools back to Settings
          for (const t of tools) if (on) delete groupPolicy[t]; else groupPolicy[t] = policy;
          paint(); refresh();
        });
        return { policy, b };
      });
      const paint = () => {
        const set = new Set(tools.map((t) => groupPolicy[t]));
        for (const s of segs) s.b.setAttribute('aria-pressed', String(set.size === 1 && set.has(s.policy)));
        sub.textContent = set.size > 1 ? 'Custom rules' : '';
      };
      paint();
      return el('div', { class: 'row' }, el('div', { class: 'row-text' }, label, sub), el('div', { class: 'seg', role: 'group', 'aria-label': label }, ...segs.map((s) => s.b)));
    });
    const permPanel = el('div', { hidden: true }, ...groupRows, el('div', { class: 'agent-rules' }, rules, btn('Add permission', () => addPermission(), 'small')));
    const permSub = el('div', { class: 'row-sub' }), addonSub = el('div', { class: 'row-sub' });
    const addonPanel = el('div', { hidden: true }, connectors.root, allowedSkills.root);
    const reveal = (title: string, sub: HTMLElement, label: string, panel: HTMLElement) => {
      const toggle = btn(label, () => { panel.hidden = !panel.hidden; toggle.setAttribute('aria-expanded', String(!panel.hidden)); }, 'small');
      toggle.setAttribute('aria-expanded', 'false');
      return [el('div', { class: 'row' }, el('div', { class: 'row-text' }, title, sub), toggle), panel];
    };

    // what is different from the saved agent, by label; the save bar names it
    const values = (): Record<string, string> => ({
      Name: name.value.trim(), Icon: glyph.value.trim(), Instructions: instructions.value, Model: JSON.stringify(target()),
      'What it may do': JSON.stringify([GROUPS.flatMap(([, tools]) => tools.map((t) => groupPolicy[t] ?? '')), rows.map((r) => [r.name.value.trim(), r.policy.value])]),
      Connectors: JSON.stringify(connectors.value()), Skills: JSON.stringify(allowedSkills.value()), 'Longest answer': maxTokens.value,
    });
    const initial = values();
    const barText = el('span', { class: 'save-bar-text' }, a ? '' : 'New agent');
    const submit = el('button', { type: 'submit', class: 'btn primary' }, a ? 'Save' : 'Create agent');
    const bar = el('div', { class: 'save-bar', role: 'region', 'aria-label': 'Unsaved changes', hidden: Boolean(a) }, barText,
      btn(a ? 'Discard' : 'Cancel', () => { if (a) { body.replaceChildren(); render(data); } else go('#/agents'); }, 'quiet'), submit);
    function refresh(): void {
      const now = values();
      const diff = Object.keys(initial).filter((k) => initial[k] !== now[k]);
      if (a) { barText.replaceChildren(...(diff.length ? changeText(diff) : [])); bar.hidden = diff.length === 0; }
      const rulesSet = Object.keys(groupPolicy).length + rows.filter((r) => r.name.value.trim()).length;
      permSub.textContent = rulesSet ? `${rulesSet} rule${rulesSet === 1 ? '' : 's'} for this agent` : 'Same as Settings › Tools';
      addonSub.textContent = connectors.value() === null && allowedSkills.value() === null ? 'All' : 'Only the ones you pick';
    }

    const more = el('details', { class: 'card disclosure' },
      el('summary', {}, icon('chev-r'), 'More options', el('span', { class: 'row-sub' }, 'What it may do, add-ons, answer length')),
      el('div', {}, ...reveal('What it may do', permSub, 'Change…', permPanel), ...reveal('Connectors and skills', addonSub, 'Choose…', addonPanel), tokensField));
    const form = el('form', { class: 'agent-form' },
      el('div', { class: 'card' },
        field('Name', name),
        field('Icon', el('span', { class: 'avatar-field' }, preview, glyph), 'One emoji. Leave it blank and the BigNose bot is used.'),
        field('Instructions', instructions, 'The first line shows on the Agents page.'),
        field('Model', choice), providerRow, modelName),
      more, bar);
    refresh();
    form.addEventListener('input', refresh);
    form.addEventListener('change', refresh);
    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      if (!validateTokens()) return;
      void guarded(async () => {
        const policies: Record<string, Policy> = Object.create(null);
        Object.assign(policies, groupPolicy);
        for (const row of rows) {
          const tool = row.name.value.trim();
          if (!/^(?:[a-zA-Z0-9_-]+\*?|\*)$/.test(tool)) throw new Error('Enter a tool name or a prefix ending in *');
          if (Object.hasOwn(policies, tool)) throw new Error(`Duplicate tool permission: ${tool}`);
          policies[tool] = row.policy.value as Policy;
        }
        const input: AgentInput = { name: name.value.trim(), icon: glyph.value.trim() || BOT, instructions: instructions.value, ...target(),
          permissions: policies, maxTokens: maxTokens.value === '' ? null : Number(maxTokens.value),
          connectors: connectors.value(), skills: allowedSkills.value() };
        if (!input.name || !input.model) throw new Error('Enter a name and a model');
        if (a) await api.patchAgent(a.id, input); else await api.createAgent(input);
        toast('Agent saved'); changed(); go('#/agents');
      }, submit);
    });
    const title = a ? `Edit ${a.name}` : 'New agent';
    body.replaceChildren(el('div', { class: 'page-head' }, el('h1', { lang: th(title) }, title)), form);
    name.focus();
  }
}
