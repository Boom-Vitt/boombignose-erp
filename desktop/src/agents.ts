// Agent management uses the same controls and local API as Settings.
import type { Api } from './api.ts';
import type { Agent, AgentInput, Policy } from './types.ts';
import { modelField } from './models.ts';
import { badge, btn, check, confirmBtn, el, field, guarded, load, select, toast } from './dom.ts';

export function mountAgents(pane: HTMLElement, api: Api, changed: (agentId?: string) => void): void {
  const fetchData = async () => {
    const [agents, settings, mcp, skills] = await Promise.all([api.listAgents(), api.getSettings(), api.listMcp(), api.listSkills()]);
    return { ...agents, ...settings, ...mcp, ...skills };
  };
  const reload = () => void load(pane, fetchData, render);

  function render(data: Awaited<ReturnType<typeof fetchData>>): void {
    const { agents, config, servers, skills } = data;
    const editor = el('div');
    const lineId = agents.find(a => a.id === config.line.agentId)?.id ?? agents[0]?.id;
    const cards = agents.map(a => el('section', { class: 'card agent-card', 'data-agent-id': a.id },
      el('h3', {}, `${a.icon} ${a.name}`, a.id === lineId && badge('LINE', 'ok')),
      el('p', { class: 'muted' }, `${a.provider} · ${a.model}`),
      el('div', { class: 'actions' },
        btn('Chat', () => { changed(a.id); location.hash = '#/chat'; }),
        btn('Edit', () => edit(a)),
        btn('Duplicate', b => void guarded(async () => {
          const source = await api.getAgent(a.id);
          const { id, createdAt, updatedAt, ...copy } = source;
          await api.createAgent({ ...copy, name: `${source.name.slice(0, 59)} copy` });
          changed(); reload();
        }, b)),
        agents.length > 1 && confirmBtn('Delete', b => void guarded(async () => {
          await api.deleteAgent(a.id); changed(); reload();
        }, b), '', 'Delete with sessions, agent notes and schedules?'))));

    function choices(label: string, names: string[], selected: string[] | null) {
      const all = check('All', selected === null);
      const picks = [...new Set([...names, ...(selected ?? [])])].map(name => ({ name, ...check(name, selected?.includes(name) ?? false) }));
      const list = el('div', { class: 'agent-picks', hidden: all.input.checked }, ...picks.map(p => p.root));
      all.input.addEventListener('change', () => { list.hidden = all.input.checked; });
      return { root: el('fieldset', {}, el('legend', {}, label), all.root, list),
        value: () => all.input.checked ? null : picks.filter(p => p.input.checked).map(p => p.name) };
    }

    function edit(a?: Agent): void {
      const name = el('input', { value: a?.name ?? '', maxlength: 64, required: true });
      const icon = el('input', { value: a?.icon ?? '🤖', maxlength: 16, required: true });
      const instructions = el('textarea', { rows: 6, value: a?.instructions ?? '' });
      const provider = select(config.providers.map(p => [p.id, p.label || p.id]), a?.provider ?? config.active.provider);
      const model = el('input', { value: a?.model ?? config.active.model, required: true, list: 'agent-models' });
      const modelRoot = modelField(api, provider, model, 'agent-models');
      const maxTokens = el('input', { type: 'number', min: 1, max: 1000000, step: 1, value: String(a?.maxTokens ?? ''), 'aria-describedby': 'agent-max-tokens-error' });
      const tokensError = el('div', { id: 'agent-max-tokens-error', class: 'notice error', role: 'alert', hidden: true });
      const tokensField = field('Max tokens', maxTokens, "Blank uses the provider's setting. Thinking models (for example qwen3 or deepseek-r1) spend tokens on thinking first, so leave it blank unless you need a limit.");
      tokensField.append(tokensError);
      function validateTokens(): boolean {
        const n = Number(maxTokens.value);
        const valid = !maxTokens.validity.badInput && (maxTokens.value === '' || (Number.isInteger(n) && n >= 1 && n <= 1000000));
        tokensError.textContent = valid ? '' : 'Max tokens must be a whole number between 1 and 1000000';
        tokensError.hidden = valid;
        maxTokens.setAttribute('aria-invalid', String(!valid));
        return valid;
      }
      maxTokens.addEventListener('input', validateTokens);
      maxTokens.addEventListener('invalid', validateTokens);
      const connectors = choices('Connectors', servers.map(s => s.name), a?.connectors ?? null);
      const allowedSkills = choices('Skills', skills.map(s => s.name), a?.skills ?? null);
      const answersLine = check('Answers LINE', a?.id === lineId);
      answersLine.input.disabled = agents.length === 1 && a?.id === lineId;
      const rows: { root: HTMLElement; name: HTMLInputElement; policy: HTMLSelectElement }[] = [];
      const permissions = el('div');
      const addPermission = (tool = '', policy: Policy = 'ask') => {
        const name = el('input', { value: tool, placeholder: 'shell or mcp__rea__*', 'aria-label': 'Tool name or prefix' });
        const choice = select([['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Deny']], policy);
        choice.setAttribute('aria-label', 'Tool permission');
        const root = el('div', { class: 'kv' }, name, choice, btn('Remove', () => {
          rows.splice(rows.findIndex(r => r.root === root), 1); root.remove();
        }, 'small'));
        rows.push({ root, name, policy: choice }); permissions.append(root);
      };
      Object.entries(a?.permissions ?? {}).forEach(([tool, policy]) => addPermission(tool, policy));
      const submit = el('button', { type: 'submit', class: 'btn primary' }, a ? 'Save agent' : 'Create agent');
      const form = el('form', { class: 'card agent-form' },
        el('h3', {}, a ? `Edit ${a.name}` : 'Create an agent'),
        el('div', { class: 'grid2' }, field('Name', name), field('Icon', icon)), field('Instructions', instructions),
        el('div', { class: 'grid2' }, field('Provider', provider), modelRoot),
        tokensField,
        el('fieldset', {}, el('legend', {}, 'Tool permissions'), permissions, btn('Add permission', () => addPermission(), 'small')),
        connectors.root, allowedSkills.root, answersLine.root,
        el('div', { class: 'actions' }, submit, btn('Cancel', () => editor.replaceChildren())));
      form.addEventListener('submit', ev => {
        ev.preventDefault();
        if (!validateTokens()) return;
        void guarded(async () => {
          const policies: Record<string, Policy> = Object.create(null);
          for (const row of rows) {
            const tool = row.name.value.trim();
            if (!/^(?:[a-zA-Z0-9_-]+\*?|\*)$/.test(tool)) throw new Error('Enter a tool name or a prefix ending in *');
            if (Object.hasOwn(policies, tool)) throw new Error(`Duplicate tool permission: ${tool}`);
            policies[tool] = row.policy.value as Policy;
          }
          const input: AgentInput = { name: name.value.trim(), icon: icon.value.trim(), instructions: instructions.value,
            provider: provider.value, model: model.value.trim(), permissions: policies,
            maxTokens: maxTokens.value === '' ? null : Number(maxTokens.value),
            connectors: connectors.value(), skills: allowedSkills.value() };
          if (!input.name || !input.icon || !input.model) throw new Error('Enter a name, icon and model');
          const saved = a ? await api.patchAgent(a.id, input) : await api.createAgent(input);
          if (answersLine.input.checked || lineId === saved.id) await api.updateSettings(c => {
            if (answersLine.input.checked) c.line.agentId = saved.id;
            else if (c.line.agentId === saved.id || (!c.line.agentId && agents[0]?.id === saved.id)) {
              const other = agents.find(agent => agent.id !== saved.id);
              if (!other) throw new Error('One agent must answer LINE');
              c.line.agentId = other.id;
            }
          });
          toast('Agent saved'); changed(); reload();
        }, submit);
      });
      editor.replaceChildren(form);
      name.focus();
    }
    pane.append(el('h2', {}, 'Agents'), el('div', { class: 'actions' }, btn('Create agent', () => edit(), 'primary')),
      editor, el('div', { class: 'cards' }, ...cards));
  }
  reload();
}
