// Settings: Connectors (MCP servers).
import type { Api } from '../api.ts';
import type { McpServerConfig, McpServerInfo, McpToolInfo } from '../types.ts';
import { badge, btn, check, confirmBtn, el, errMsg, field, guarded, load, select, toast } from '../dom.ts';

const BUILTIN = 'rea';
const NAME_RE = /^[A-Za-z0-9_-]{1,32}$/;
const ENV_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/;

/** Splits on spaces, keeping "double" and 'single' quoted parts together. */
const splitArgs = (s: string): string[] => (s.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((a) => a.replace(/^(["'])(.*)\1$/, '$2'));
const secretName = (server: string, key: string) => `MCP_${server}_${key}`.toUpperCase().replace(/[^A-Z0-9_]/g, '_');

export function mountConnectors(pane: HTMLElement, api: Api): void {
  let servers: McpServerInfo[] = [];
  let polls = 0;
  const cards = el('div', { class: 'cards' });

  async function refreshCards(): Promise<void> {
    try {
      servers = (await api.listMcp()).servers;
      const sorted = [...servers].sort((a, b) => (a.name === BUILTIN ? -1 : b.name === BUILTIN ? 1 : a.name.localeCompare(b.name)));
      cards.replaceChildren(...sorted.map(card));
      if (!sorted.length) cards.append(el('p', { class: 'muted' }, 'No connectors yet.'));
      // an enabled server that is neither connected nor failed is still starting (a first npx run is slow)
      if (servers.some((s) => s.enabled && !s.connected && !s.error) && polls++ < 90) window.setTimeout(() => { if (cards.isConnected) void refreshCards(); }, 2000);
    } catch (e) {
      cards.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void refreshCards())));
    }
  }

  function card(s: McpServerInfo): HTMLElement {
    const builtin = s.name === BUILTIN;
    const [stateText, tone] = !s.enabled ? ['Off', ''] : s.connected ? ['Connected', 'ok'] : s.error ? ['Error', 'bad'] : ['Starting…', 'warn'];
    const result = el('div', { class: 'result', role: 'status' });
    const panel = el('div', { class: 'tools-panel', hidden: true });

    const toggle = check('Enabled', s.enabled, (on) => {
      void guarded(async () => { await api.patchMcp(s.name, { enabled: on }); polls = 0; await refreshCards(); }).then((ok) => { if (!ok) void refreshCards(); });
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
    }, b));

    let loaded = false;
    const toolsBtn = btn('Tools', () => {
      panel.hidden = !panel.hidden;
      if (!panel.hidden && !loaded) { loaded = true; void load(panel, () => api.mcpTools(s.name), ({ tools }) => renderTools(panel, s.name, tools)); }
    });

    return el('section', { class: 'card' },
      el('h3', {}, s.name, badge(s.transport), builtin && badge('Built in'), badge(stateText, tone)),
      builtin && el('p', { class: 'muted' }, 'Reverse-engineering tools for local binaries, apps and web pages. Off until you turn it on; the first start downloads the package.'),
      s.error && el('p', { class: 'notice error' }, s.error),
      el('div', { class: 'actions' },
        builtin && !s.enabled ? btn('Enable', (b) => void guarded(async () => { await api.patchMcp(s.name, { enabled: true }); polls = 0; await refreshCards(); }, b), 'primary') : toggle.root,
        test, toolsBtn,
        !builtin && confirmBtn('Delete', (b) => void guarded(async () => { await api.deleteMcp(s.name); await refreshCards(); }, b))),
      result, panel);
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
    panel.append(
      el('div', { class: 'actions' }, el('label', {}, el('span', { class: 'sr-only' }, 'Filter tools'), filter), btn('All', () => setVisible(true), 'small'), btn('None', () => setVisible(false), 'small'), count,
        btn('Save selection', (b) => void guarded(async () => {
          await api.patchMcp(name, { tools: rows.filter((r) => r.box.checked).map((r) => r.t.name) });
          toast('Tool selection saved');
        }, b), 'primary')),
      el('div', { class: 'tool-picks' }, ...items));
    if (!rows.length) panel.append(el('p', { class: 'muted' }, 'This server lists no tools.'));
  }

  // ---- add form
  function kvEditor(label: string, namePlaceholder: string, nameRe: RegExp) {
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
          if (!nameRe.test(k)) throw new Error(`"${k}" is not a valid ${label.toLowerCase()} name`);
          if (!v) throw new Error(`Enter a value for ${k}`);
          out.push([k, v]);
        }
        return out;
      },
    };
  }

  function addForm(): HTMLElement {
    const name = el('input', { type: 'text', placeholder: 'my-server', autocomplete: 'off', spellcheck: 'false', required: true });
    const transport = select([['stdio', 'Local command (stdio)'], ['http', 'Remote URL (HTTP)']], 'stdio');
    const command = el('input', { type: 'text', placeholder: 'npx', autocomplete: 'off', spellcheck: 'false' });
    const args = el('input', { type: 'text', placeholder: '-y some-package@1.0.0 mcp', autocomplete: 'off', spellcheck: 'false' });
    const url = el('input', { type: 'url', placeholder: 'https://example.com/mcp', autocomplete: 'off', spellcheck: 'false' });
    const env = kvEditor('Environment variable', 'NAME', ENV_RE);
    const headers = kvEditor('Header', 'Authorization', HEADER_RE);
    const stdio = el('div', {}, field('Command', command), field('Arguments', args, 'Separated by spaces; use quotes for an argument with spaces.'), env.root);
    const http = el('div', { hidden: true }, field('URL', url), headers.root);
    transport.addEventListener('change', () => { stdio.hidden = transport.value !== 'stdio'; http.hidden = transport.value !== 'http'; });
    const submit = el('button', { type: 'submit', class: 'btn primary' }, 'Add connector');

    const form = el('form', { class: 'card', autocomplete: 'off' },
      el('h3', {}, 'Add a connector'),
      el('p', { class: 'muted' }, 'Variable and header values are saved as secrets and referenced by name; they never go into the config file.'),
      el('div', { class: 'grid2' }, field('Name', name), field('Type', transport)),
      stdio, http, el('div', { class: 'actions' }, submit));

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      void guarded(async () => {
        const n = name.value.trim();
        if (!NAME_RE.test(n)) throw new Error('Name: 1 to 32 letters, digits, "-" or "_"');
        if (servers.some((s) => s.name === n)) throw new Error(`A connector named ${n} already exists`);
        let config: McpServerConfig;
        const refs = async (pairs: [string, string][]) => {
          const out: Record<string, string> = {};
          for (const [k, v] of pairs) { const sn = secretName(n, k); await api.putSecret(sn, v); out[k] = '${' + sn + '}'; }
          return Object.keys(out).length ? out : undefined;
        };
        if (transport.value === 'stdio') {
          if (!command.value.trim()) throw new Error('Enter a command');
          const pairs = env.values();
          config = { transport: 'stdio', command: command.value.trim(), args: splitArgs(args.value), env: await refs(pairs), enabled: true };
        } else {
          let u: URL;
          try { u = new URL(url.value.trim()); } catch { throw new Error('Enter a valid URL'); }
          if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('The URL must start with http:// or https://');
          const pairs = headers.values();
          config = { transport: 'http', url: u.toString(), headers: await refs(pairs), enabled: true };
        }
        await api.addMcp(n, config);
        toast(`Added ${n}`);
        form.reset();
        env.clear(); headers.clear();
        stdio.hidden = false; http.hidden = true;
        polls = 0;
        await refreshCards();
      }, submit);
    });
    return form;
  }

  pane.append(el('h2', {}, 'Connectors'),
    el('p', { class: 'muted' }, 'Connectors give BigNose extra tools through the Model Context Protocol. Every tool call still asks for approval unless you change its policy.'),
    cards, addForm());
  void refreshCards();
}
