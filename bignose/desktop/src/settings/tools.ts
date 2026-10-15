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
    // ---- what BigNose may do: four groups write one exact rule per tool into config.permissions;
    // the policy a group shows is the one the core uses: the tool's own rule, else the longest `prefix*` rule, else the default
    const known = new Set(GROUPS.flatMap(([, tools]) => tools));
    const group: Record<string, Policy> = {};
    for (const [tool, policy] of Object.entries(config.permissions)) if (known.has(tool)) group[tool] = policy;
    const rules: { root: HTMLElement; name: HTMLInputElement; policy: HTMLSelectElement }[] = [];
    const policyOf = (tool: string): Policy => {
      if (Object.hasOwn(group, tool)) return group[tool]!;
      const typed = rules.map((r) => [r.name.value.trim(), r.policy.value as Policy] as const);
      const prefix = typed.filter(([n]) => n.endsWith('*') && tool.startsWith(n.slice(0, -1))).sort((a, b) => b[0].length - a[0].length)[0];
      return typed.find(([n]) => n === tool)?.[1] ?? prefix?.[1] ?? DEFAULT_POLICY[tool]!;
    };
    const effective = (tools: string[]): Policy | undefined => {
      const set = new Set(tools.map(policyOf));
      return set.size === 1 ? [...set][0] : undefined;
    };
    const policyText = (p?: Policy) => POLICIES.find(([v]) => v === p)?.[1] ?? 'Custom';
    /** The explicit rules a group holds: pressing a segment writes them even when the shown policy would not change. */
    const entries = (tools: string[]) => JSON.stringify(tools.map((t) => group[t] ?? null));
    const repaints: (() => void)[] = [];
    const groupRows = GROUPS.map(([label, tools]) => {
      const sub = el('div', { class: 'row-sub' });
      const control = seg(label, POLICIES, (v) => { for (const t of tools) group[t] = v as Policy; refresh(); });
      repaints.push(() => {
        const v = effective(tools);
        control.set(v);
        sub.textContent = v ? '' : tools.map((t) => `${t} ${policyText(policyOf(t))}`).join(' · ');
      });
      return el('div', { class: 'row' }, el('div', { class: 'row-text' }, label, sub), control.root);
    });

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
    repaints.forEach((paint) => paint());

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
        row('Rules for single tools', 'Name one tool, or a prefix ending in *. A rule for one tool beats a prefix rule, and a prefix rule beats the defaults. The groups above write one rule for each of their tools.', btn('Add rule', () => { addRule(); refresh(); }, 'small')),
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
    const initialEntries = GROUPS.map(([, tools]) => entries(tools));
    const groupEdited = (i: number) => entries(GROUPS[i]![1]) !== initialEntries[i];
    const bar = saveBar(reload, { button: true });
    function refresh(): void {
      repaints.forEach((paint) => paint());
      const changes = dirty(initial, values(), { hidden: ['Tool rules', 'Hooks'] });
      // a pressed segment that keeps the shown policy (a `*` rule already decided it) still writes rules, so it still needs Save
      GROUPS.forEach(([label], i) => { if (groupEdited(i) && !changes.some((c) => c.label === label)) changes.push({ label }); });
      bar.set(changes);
    }

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
      if (GROUPS.some((_, i) => groupEdited(i)) || changed('Tool rules')) {
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
