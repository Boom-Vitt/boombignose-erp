// Settings › Tools › Add-ons: each connector (MCP server) is a row with a switch; the add form sits under More options.
import type { Api } from '../api.ts';
import type { McpServerInfo, McpToolInfo } from '../types.ts';
import { badge, btn, confirmDialog, el, errMsg, field, guarded, load, select, toast } from '../dom.ts';
import { addConnector, deleteConnector } from './connector-form.ts';
import { sw } from './parts.ts';

const BUILTIN = 'rea';

/** Fills `pane` (a list of rows) with the connectors and keeps it fresh while one is still starting. */
export function mountConnectors(pane: HTMLElement, api: Api): { refresh(restart?: boolean): Promise<void> } {
  let polls = 0;

  async function refresh(restart = false): Promise<void> {
    if (restart) polls = 0;
    try {
      const servers = (await api.listMcp()).servers;
      const sorted = [...servers].sort((a, b) => (a.name === BUILTIN ? -1 : b.name === BUILTIN ? 1 : a.name.localeCompare(b.name)));
      pane.replaceChildren(...sorted.map(connector));
      if (!sorted.length) pane.append(el('div', { class: 'row empty-row' }, 'No connectors yet.'));
      // a first npx run is slow: poll until every starting connector is up or failed
      if (servers.some((s) => s.starting) && polls++ < 90) window.setTimeout(() => { if (pane.isConnected) void refresh(); }, 2000);
    } catch (e) {
      pane.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refresh())));
    }
  }

  function connector(s: McpServerInfo): HTMLElement {
    const builtin = s.name === BUILTIN;
    const [stateText, tone] = !s.enabled ? ['Off', ''] : s.connected ? ['Connected', 'ok'] : s.starting ? ['Starting…', 'warn'] : ['Error', 'bad'];
    const result = el('span', { class: 'result', role: 'status' });
    const panel = el('div', { class: 'tools-panel', hidden: true });

    // the switch is off the moment it is pressed and stays disabled until the daemon answered
    const toggle = sw(`Turn ${s.name} on`, s.enabled);
    toggle.addEventListener('change', () => {
      void guarded(async () => { await api.patchMcp(s.name, { enabled: toggle.checked }); await refresh(true); }, toggle).then((ok) => { if (!ok) void refresh(); });
    });

    const test = btn('Test', (b) => void guarded(async () => {
      result.className = 'result';
      result.textContent = 'Testing… (the first run can take a minute)';
      try {
        const r = await api.testMcp(s.name);
        result.className = `result ${r.ok ? 'ok' : 'bad'}`;
        result.textContent = r.ok ? `OK: ${r.tools} tools available` : `Failed: ${r.error ?? 'unknown error'}`;
      } catch (e) {
        result.className = 'result bad';
        result.textContent = errMsg(e);
      }
    }, b), 'quiet small');

    let loaded = false;
    const toolsBtn = btn('Tools', () => {
      panel.hidden = !panel.hidden;
      if (panel.hidden || loaded) return;
      loaded = true;
      // a connector that is off, starting or failed lists no tools; offering to save then would store an empty selection
      if (!s.connected) panel.replaceChildren(el('p', { class: 'muted pad' }, !s.enabled ? 'Turn this connector on to choose its tools.'
        : s.starting ? 'This connector is still starting. Choose its tools once it shows Connected.'
        : 'This connector is not connected, so its tools cannot be listed. Fix the error above, then turn it off and on again to retry.'));
      else void load(panel, () => api.mcpTools(s.name), ({ tools }) => renderTools(panel, s.name, tools));
    }, 'quiet small');

    const remove = btn('Delete', () => void (async () => {
      if (!await confirmDialog({ title: `Delete ${s.name}?`, body: 'Its saved variables and headers are deleted too.', action: 'Delete' })) return;
      await guarded(async () => { await deleteConnector(api, s.name); await refresh(true); });
    })(), 'quiet small danger');

    const count = s.connected ? `${s.tools?.length ?? 0} tools` : s.enabled ? (s.starting ? 'Starting…' : 'Not connected') : 'Off';
    return el('div', { class: 'connector', 'data-name': s.name },
      el('div', { class: 'row' },
        el('div', { class: 'row-text' },
          el('div', { class: 'connector-name' }, s.name, badge(s.transport), builtin && badge('Built in'), badge(stateText, tone)),
          builtin && el('div', { class: 'row-sub' }, 'Reverse-engineering tools for local binaries, apps and web pages. Off until you turn it on; the first start downloads the package.'),
          s.error && el('p', { class: 'notice error' }, s.error),
          el('div', { class: 'row-sub addon-actions' }, count, test, toolsBtn, !builtin && remove, result)),
        toggle),
      panel);
  }

  function renderTools(panel: HTMLElement, name: string, tools: McpToolInfo[]): void {
    const rows = tools.map((t) => ({ t, box: el('input', { type: 'checkbox', checked: t.selected }) }));
    const count = el('span', { class: 'muted' });
    const update = () => { count.textContent = `${rows.filter((r) => r.box.checked).length} of ${rows.length} selected`; };
    const filter = el('input', { type: 'search', placeholder: 'Filter tools', autocomplete: 'off' });
    const items = rows.map(({ t, box }) => {
      box.addEventListener('change', update);
      return el('label', { class: 'tool-pick' }, box, el('span', { class: 'tool-pick-name' }, t.name), t.description && el('span', { class: 'hint' }, t.description.slice(0, 160)));
    });
    filter.addEventListener('input', () => {
      const q = filter.value.trim().toLowerCase();
      items.forEach((it, i) => { it.hidden = !!q && !rows[i].t.name.toLowerCase().includes(q); });
    });
    const setVisible = (on: boolean) => { items.forEach((it, i) => { if (!it.hidden) rows[i].box.checked = on; }); update(); };
    update();
    if (!rows.length) { panel.append(el('p', { class: 'muted pad' }, 'This server lists no tools.')); return; }
    panel.append(
      el('div', { class: 'actions' }, el('label', {}, el('span', { class: 'sr-only' }, 'Filter tools'), filter), btn('All', () => setVisible(true), 'small'), btn('None', () => setVisible(false), 'small'), count,
        btn('Save selection', (b) => void guarded(async () => {
          await api.patchMcp(name, { tools: rows.filter((r) => r.box.checked).map((r) => r.t.name) });
          toast('Tool selection saved');
        }, b), 'primary')),
      el('div', { class: 'tool-picks' }, ...items));
  }

  void refresh();
  return { refresh };
}

// ---- add form
function kvEditor(label: string, namePlaceholder: string) {
  const rows = el('div', { class: 'kv-rows' });
  const addRow = () => {
    const k = el('input', { type: 'text', placeholder: namePlaceholder, 'aria-label': `${label} name`, autocomplete: 'off', spellcheck: 'false' });
    const v = el('input', { type: 'password', placeholder: 'Value (stored as a secret)', 'aria-label': `${label} value`, autocomplete: 'off' });
    const row = el('div', { class: 'kv' }, k, v, btn('Remove', () => row.remove(), 'small'));
    rows.appendChild(row);
  };
  return {
    root: el('div', { class: 'field' }, el('div', { class: 'field-label' }, label), rows, btn(`Add ${label.toLowerCase()}`, addRow, 'small')),
    clear: () => rows.replaceChildren(),
    values(): [string, string][] {
      const out: [string, string][] = [];
      for (const row of Array.from(rows.children)) {
        const [k, v] = Array.from(row.querySelectorAll('input')).map((i) => i.value.trim());
        if (!k && !v) continue;
        out.push([k, v]);
      }
      return out;
    },
  };
}

/** The add form (today's logic): values become secrets, the config only holds references. `added` runs after a connector was added. */
export function connectorForm(api: Api, added: () => Promise<void> | void): HTMLElement {
  const name = el('input', { type: 'text', placeholder: 'my-server', autocomplete: 'off', spellcheck: 'false', required: true });
  const transport = select([['stdio', 'Local command (stdio)'], ['http', 'Remote URL (HTTP)']], 'stdio');
  const command = el('input', { type: 'text', placeholder: 'npx', autocomplete: 'off', spellcheck: 'false' });
  const args = el('input', { type: 'text', placeholder: '-y some-package@1.0.0 mcp', autocomplete: 'off', spellcheck: 'false' });
  const url = el('input', { type: 'url', placeholder: 'https://example.com/mcp', autocomplete: 'off', spellcheck: 'false' });
  const env = kvEditor('Environment variable', 'NAME');
  const headers = kvEditor('Header', 'Authorization');
  const stdio = el('div', {}, field('Command', command), field('Arguments', args, 'Separated by spaces; use quotes for an argument with spaces.'), env.root);
  const http = el('div', { hidden: true }, field('URL', url), headers.root);
  transport.addEventListener('change', () => { stdio.hidden = transport.value !== 'stdio'; http.hidden = transport.value !== 'http'; });
  const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Add connector');

  const form = el('form', { class: 'connector-form rows', autocomplete: 'off' },
    el('div', { class: 'row' }, el('div', { class: 'row-text' }, 'Add a connector',
      el('div', { class: 'row-sub' }, 'Variable and header values are saved as secrets and referenced by name; they never go into the config file.'))),
    field('Name', name), field('Type', transport), stdio, http, el('div', { class: 'row' }, el('span', { class: 'spacer' }), submit));

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    void guarded(async () => {
      const n = name.value.trim();
      const kind = transport.value === 'stdio' ? 'stdio' : 'http';
      await addConnector(api, { name: n, transport: kind, command: command.value, args: args.value, url: url.value,
        pairs: kind === 'stdio' ? env.values() : headers.values() });
      toast(`Added ${n}`);
      form.reset();
      env.clear(); headers.clear();
      stdio.hidden = false; http.hidden = true;
      await added();
    }, submit);
  });
  return form;
}
