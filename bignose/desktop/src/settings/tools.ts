// Settings › Tools: what BigNose may do, the workspace folder, add-ons, and the expert rules behind More options.
import type { Api } from '../api.ts';
import type { Policy, Settings, SkillSummary } from '../types.ts';
import { btn, el, field, guarded, icon, load, select, toast } from '../dom.ts';
import { checkWorkspace, DEFAULT_POLICY, dirty, GROUPS, hooksFromConfig, hooksToConfig, POLICIES } from './forms.ts';
import { connectorForm, mountConnectors } from './connectors.ts';
import { hooksEditor } from './hooks.ts';
import { row, saveBar, seg } from './parts.ts';
import { mountSkills } from './skills.ts';

export function mountTools(pane: HTMLElement, api: Api): void {
  const reload = () => void load(pane, async () => {
    const [settings, skills] = await Promise.all([api.getSettings(), api.listSkills()]);
    return { ...settings, skills: skills.skills };
  }, render);

  /** Skills open as their own view, with a way back to the tab. */
  function openSkills(): void {
    const host = el('div');
    pane.replaceChildren(el('button', { type: 'button', class: 'back', onclick: reload }, icon('chev-r'), 'Tools'), host);
    mountSkills(host, api);
  }

  function render({ config, skills }: Settings & { skills: SkillSummary[] }): void {
    // ---- what BigNose may do: four groups write config.permissions; any other rule keeps its own row
    const known = new Set(GROUPS.flatMap(([, tools]) => tools));
    const group: Record<string, Policy> = {};
    for (const [tool, policy] of Object.entries(config.permissions)) if (known.has(tool)) group[tool] = policy;
    const effective = (tools: string[]): Policy | undefined => {
      const set = new Set(tools.map((t) => group[t] ?? DEFAULT_POLICY[t]));
      return set.size === 1 ? [...set][0] : undefined;
    };
    const policyText = (p?: Policy) => POLICIES.find(([v]) => v === p)?.[1] ?? 'Custom';
    const groupRows = GROUPS.map(([label, tools]) => {
      const sub = el('div', { class: 'row-sub' });
      const control = seg(label, POLICIES, (v) => { for (const t of tools) group[t] = v as Policy; paint(); refresh(); });
      const paint = () => { const v = effective(tools); control.set(v); sub.textContent = v ? '' : 'Custom rules in More options'; };
      paint();
      return el('div', { class: 'row' }, el('div', { class: 'row-text' }, label, sub), control.root);
    });

    const rules: { root: HTMLElement; name: HTMLInputElement; policy: HTMLSelectElement }[] = [];
    const ruleList = el('div', { class: 'agent-rules' });
    const addRule = (tool = '', policy: Policy = 'ask') => {
      const name = el('input', { type: 'text', value: tool, placeholder: 'shell or mcp__rea__*', 'aria-label': 'Tool name or prefix', autocomplete: 'off', spellcheck: 'false' });
      const choose = select([['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Never']], policy);
      choose.setAttribute('aria-label', 'Tool permission');
      const root = el('div', { class: 'kv' }, name, choose, btn('Remove', () => { rules.splice(rules.findIndex((r) => r.root === root), 1); root.remove(); refresh(); }, 'small'));
      rules.push({ root, name, policy: choose });
      ruleList.append(root);
    };
    Object.entries(config.permissions).filter(([tool]) => !known.has(tool)).forEach(([tool, policy]) => addRule(tool, policy));

    // ---- the workspace folder (the daemon expands ~ and checks the folder exists when it changes)
    const workspace = el('input', { type: 'text', value: config.agent.workspace, required: true, spellcheck: 'false', autocomplete: 'off' });

    // ---- add-ons
    const connectorList = el('div', { class: 'rows' });
    const connectors = mountConnectors(connectorList, api);
    const skillsRow = row('Skills', `${skills.length} skill${skills.length === 1 ? '' : 's'}`, btn('Manage', openSkills, 'small'));

    // ---- More options
    const hooks = hooksEditor(hooksFromConfig(config), () => refresh());
    const more = el('details', { class: 'card disclosure' },
      el('summary', {}, icon('chev-r'), 'More options', el('span', { class: 'row-sub' }, 'Rules for single tools, add a connector, hooks')),
      el('div', {},
        row('Rules for single tools', 'One rule per tool, or a prefix ending in *. A rule here beats the groups above.', btn('Add rule', () => { addRule(); refresh(); }, 'small')),
        ruleList,
        connectorForm(api, () => connectors.refresh(true)),
        row('Hooks', 'Shell commands that run around tool calls. The event details come as JSON on standard input.'),
        hooks.root));

    // ---- the save bar names what differs
    const values = (): Record<string, string> => ({
      'Workspace folder': workspace.value.trim(),
      ...Object.fromEntries(GROUPS.map(([label, tools]) => [label, policyText(effective(tools))])),
      'Tool rules': JSON.stringify(rules.map((r) => [r.name.value.trim(), r.policy.value])),
      Hooks: JSON.stringify(hooks.value()),
    });
    const initial = values();
    const bar = saveBar(reload, { button: true });
    function refresh(): void { bar.set(dirty(initial, values(), { hidden: ['Tool rules', 'Hooks'] })); }

    const root = el('div', { class: 'tools-page' },
      el('h2', { class: 'group-title' }, 'What BigNose may do'),
      el('div', { class: 'card' }, ...groupRows),
      el('p', { class: 'group-foot' }, 'Never hides the tool from BigNose completely. Ask shows a question each time.'),
      el('h2', { class: 'group-title' }, 'Workspace folder'),
      el('div', { class: 'card' }, field('Folder BigNose works in', workspace, 'Used by the file and shell tools. Use a full path, or start with ~/.')),
      el('h2', { class: 'group-title' }, 'Add-ons'),
      el('div', { class: 'card' }, connectorList, skillsRow),
      more, bar.root);
    root.addEventListener('input', refresh);
    root.addEventListener('change', refresh);

    bar.submit.addEventListener('click', () => void guarded(async () => {
      const now = values(), changed = (k: string) => now[k] !== initial[k];
      const folder = changed('Workspace folder') ? checkWorkspace(workspace.value) : undefined;
      let permissions: Record<string, Policy> | undefined;
      if (GROUPS.some(([label]) => changed(label)) || changed('Tool rules')) {
        permissions = Object.create(null) as Record<string, Policy>;
        Object.assign(permissions, group);
        for (const r of rules) {
          const tool = r.name.value.trim();
          if (!/^(?:[a-zA-Z0-9_-]+\*?|\*)$/.test(tool)) throw new Error('Enter a tool name or a prefix ending in *');
          if (Object.hasOwn(permissions, tool)) throw new Error(`Two rules name ${tool}`);
          permissions[tool] = r.policy.value as Policy;
        }
      }
      const hooksValue = changed('Hooks') ? hooks.value() : undefined;
      await api.updateSettings((c) => {
        if (folder !== undefined) c.agent.workspace = folder;
        if (permissions) c.permissions = { ...permissions };
        if (hooksValue) c.hooks = hooksToConfig(c, hooksValue).hooks;
      });
      toast('Saved');
      reload();
    }, bar.submit));

    pane.append(root);
  }

  reload();
}
