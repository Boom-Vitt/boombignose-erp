// Chat screen: session list with search, streaming answer, live tool activity, approval cards, stop.
import { ApiError } from './api.ts';
import type { Api } from './api.ts';
import type { Agent, ApiEvent, Command, Message, SessionSummary } from './types.ts';
import { btn, confirmBtn, el, errMsg, formatTime, guarded, renderText, select, field, toast } from './dom.ts';

export interface Chat {
  root: HTMLElement;
  onEvent(e: ApiEvent): void;
  /** Clear stale event state before the new stream's replay is read. */
  onStreamOpen(): void;
  /** Reload the list and the open chat, e.g. after the event stream reconnects. */
  refresh(): void;
  refreshAgents(): Promise<void>;
  selectAgent(id: string): Promise<void>;
  agentId(): string | undefined;
  leave(): void;
}

interface Approval { sessionId: string; tool: string; input: Record<string, unknown>; state: 'pending' | 'allowed' | 'denied'; card?: HTMLElement }
interface ToolRow { root: HTMLElement; finish(isError: boolean, output: string): void }

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const SUMMARY_PREFIX = '[Summary of earlier conversation]';

export function createChat(api: Api, agentChanged: (agent: Agent) => void = () => {}): Chat {
  let agents: Agent[] = [];
  let selectedAgent: string | undefined;
  let agentSeq = 0;
  let commands: Command[] = [];
  let matches: Command[] = [];
  let commandIndex = 0;
  let pickerClosed = false;
  const notifications = new Map<string, string[]>();
  let currentId: string | null = null;
  let loadSeq = 0;
  let listSeq = 0;
  let query = '';
  let sending = false;
  let listTimer = 0;
  let live: { body: HTMLElement; text: string } | null = null;
  const running = new Set<string>();
  const approvals = new Map<string, Approval>();
  const tools = new Map<string, ToolRow>();
  let sessions: SessionSummary[] = [];

  // ---- DOM
  const agentPicker = select([], '');
  agentPicker.setAttribute('aria-label', 'Chat agent');
  const providerPicker = select([], '');
  const modelInput = el('input', { 'aria-label': 'Agent model', required: true });
  const modelBar = el('div', { class: 'chat-model' }, field('Provider', providerPicker), field('Model', modelInput),
    btn('Save model', b => void guarded(async () => {
      if (!selectedAgent || !modelInput.value.trim()) throw new Error('Choose an agent and enter a model');
      await api.patchAgent(selectedAgent, { provider: providerPicker.value, model: modelInput.value.trim() });
      await refreshAgents();
    }, b), 'small'));
  const picker = el('div', { id: 'slash-picker', class: 'slash-picker', role: 'listbox', 'aria-label': 'Slash commands', hidden: true });
  const search = el('input', { type: 'search', placeholder: 'Search chats', autocomplete: 'off' });
  const list = el('ul', { class: 'session-list' });
  const messages = el('div', { class: 'messages', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const input = el('textarea', { rows: 1, placeholder: 'Message BigNose', 'aria-label': 'Message', 'aria-autocomplete': 'list', 'aria-controls': 'slash-picker', 'aria-expanded': 'false' });
  const sendBtn = btn('Send', () => void send(), 'primary');
  const stopBtn = btn('Stop', () => void stop(), 'danger');
  const root = el('div', { class: 'chat' },
    el('aside', { class: 'sessions' },
      el('div', { class: 'sessions-head' }, field('Agent', agentPicker),
        btn('New chat', () => { void open(null); input.focus(); }, 'primary block'),
        el('label', { class: 'sr-label' }, el('span', { class: 'sr-only' }, 'Search chats'), search)),
      list),
    el('section', { class: 'convo' }, modelBar, messages, el('div', { class: 'composer' }, picker, input, el('div', { class: 'composer-actions' }, sendBtn, stopBtn))));

  // ---- helpers
  const isBusy = () => sending || (currentId !== null && running.has(currentId));

  function updateComposer(): void {
    const busy = isBusy();
    sendBtn.disabled = !selectedAgent;
    sendBtn.hidden = busy;
    stopBtn.hidden = !busy;
  }

  function append(node: Node): void {
    const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    messages.appendChild(node);
    if (stick) messages.scrollTop = messages.scrollHeight;
  }

  function keepBottom(fn: () => void): void {
    const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    fn();
    if (stick) messages.scrollTop = messages.scrollHeight;
  }

  function bubble(role: 'user' | 'assistant', text: string): { root: HTMLElement; body: HTMLElement; text: string } {
    const body = el('div', { class: 'msg-body' });
    renderText(body, text);
    const root = el('div', { class: `msg ${role}` }, body);
    append(root);
    return { root, body, text };
  }

  const note = (text: string, tone = '') => append(el('div', { class: `note ${tone}`.trim() }, text));

  function toolRow(name: string, input: Record<string, unknown>): ToolRow {
    const status = el('span', { class: 'tool-status running' }, 'running');
    const out = el('pre', { class: 'tool-out' });
    const first = Object.values(input).find((v) => typeof v === 'string') as string | undefined;
    const row = el('details', { class: 'tool' },
      el('summary', {}, el('span', { class: 'tool-name' }, name), el('span', { class: 'tool-hint' }, (first ?? '').slice(0, 80)), status),
      el('div', { class: 'tool-body' },
        el('div', { class: 'tool-label' }, 'Input'), el('pre', {}, pretty(input)),
        el('div', { class: 'tool-label' }, 'Result'), out));
    return {
      root: row,
      finish(isError, output) {
        status.className = `tool-status ${isError ? 'error' : 'done'}`;
        status.textContent = isError ? 'error' : 'done';
        out.textContent = output || '(no output)';
      },
    };
  }

  function addToolRow(callId: string, name: string, input: Record<string, unknown>): void {
    const row = toolRow(name, input);
    tools.set(callId, row);
    append(row.root);
  }

  function approvalCard(id: string, a: Approval): HTMLElement {
    const status = el('span', { class: 'approval-status' });
    const allow = btn('Allow', () => decide(true), 'primary');
    const deny = btn('Deny', () => decide(false), 'danger');
    const decide = (ok: boolean) => {
      allow.disabled = deny.disabled = true;
      api.decideApproval(id, ok).then(() => { status.textContent = 'Sent…'; }, (e) => {
        if (e instanceof ApiError && e.status === 404) { status.textContent = 'Already decided'; return; }
        allow.disabled = deny.disabled = false;
        toast(errMsg(e), 'error');
      });
    };
    const card = el('div', { class: 'approval', role: 'group', 'aria-label': `Approval needed for ${a.tool}` },
      el('div', { class: 'approval-title' }, 'Allow ', el('code', {}, a.tool), '?'),
      el('pre', {}, pretty(a.input)),
      el('div', { class: 'approval-actions' }, allow, deny, status));
    return card;
  }

  function settleCard(a: Approval): void {
    a.card?.classList.add(a.state);
    a.card?.querySelector('.approval-actions')?.replaceChildren(el('span', { class: 'approval-status' }, a.state === 'allowed' ? 'Allowed' : 'Denied'));
  }

  function showApprovals(): void {
    for (const [id, a] of approvals) {
      if (a.sessionId !== currentId) continue;
      a.card = approvalCard(id, a);
      append(a.card);
      if (a.state !== 'pending') settleCard(a);
    }
  }

  function renderHistory(msgs: Message[]): void {
    messages.replaceChildren();
    tools.clear();
    live = null;
    if (!msgs.length) messages.appendChild(el('div', { class: 'empty' }, el('h2', {}, 'How can I help?'), el('p', { class: 'muted' }, 'Ask anything. BigNose can use tools, and asks before it changes anything.')));
    for (const m of msgs) {
      for (const b of m.content) {
        if (b.type === 'text') {
          if (!b.text.trim()) continue;
          if (b.text.startsWith(SUMMARY_PREFIX)) note('Earlier messages were summarised to save space.');
          else bubble(m.role, b.text);
        } else if (b.type === 'tool_use') addToolRow(b.id, b.name, b.input);
        else tools.get(b.toolUseId)?.finish(!!b.isError, b.content);
      }
    }
    for (const text of notifications.get(currentId ?? '') ?? []) note(text);
    messages.scrollTop = messages.scrollHeight;
  }

  // ---- sessions
  function renderList(): void {
    list.replaceChildren(...sessions.map((s) => {
      const active = s.id === currentId;
      const waiting = [...approvals.values()].some((a) => a.sessionId === s.id && a.state === 'pending');
      return el('li', { class: 'session-item' },
        el('button', { type: 'button', class: `session${active ? ' active' : ''}`, 'aria-current': active ? 'true' : undefined, onclick: () => void open(s.id) },
          el('span', { class: 'session-title' }, s.title || 'New chat', running.has(s.id) && el('span', { class: 'dot', title: 'Running' }), waiting && el('span', { class: 'badge warn' }, 'Needs approval')),
          el('span', { class: 'session-sub' }, s.snippet || formatTime(s.updatedAt))),
        confirmBtn('Delete', (b) => void guarded(async () => {
          await api.deleteSession(s.id);
          if (currentId === s.id) await open(null);
          await refreshList();
        }, b), 'small', 'Sure?'));
    }));
    if (!sessions.length) list.appendChild(el('li', { class: 'muted pad' }, query ? 'No chats match.' : 'No chats yet.'));
  }

  async function refreshList(): Promise<void> {
    if (!selectedAgent) return;
    const seq = ++listSeq; // a slow answer must not overwrite a newer search
    try {
      const found = (await api.listSessions(query || undefined, undefined, selectedAgent)).sessions;
      if (seq !== listSeq) return;
      sessions = found;
      renderList();
    } catch (e) {
      if (seq !== listSeq) return;
      list.replaceChildren(el('li', { class: 'notice error pad' }, errMsg(e)));
    }
  }

  function scheduleList(): void {
    window.clearTimeout(listTimer);
    listTimer = window.setTimeout(() => void refreshList(), 250);
  }

  async function open(id: string | null): Promise<void> {
    currentId = id;
    const seq = ++loadSeq;
    renderList();
    updateComposer();
    if (!id) { renderHistory([]); return; }
    messages.replaceChildren(el('p', { class: 'muted pad' }, 'Loading…'));
    try {
      const s = await api.getSession(id);
      if (seq !== loadSeq) return;
      renderHistory(s.messages);
      showApprovals();
    } catch (e) {
      if (seq !== loadSeq) return;
      messages.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void open(id))));
    }
  }

  async function reloadCurrent(): Promise<void> {
    const id = currentId;
    if (!id) return;
    const seq = ++loadSeq;
    try {
      const s = await api.getSession(id);
      if (seq !== loadSeq || id !== currentId) return;
      renderHistory(s.messages);
      showApprovals();
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  // ---- agents and commands
  async function refreshAgents(): Promise<void> {
    const seq = ++agentSeq;
    try {
      const [found, settings] = await Promise.all([api.listAgents(), api.getSettings()]);
      if (seq !== agentSeq) return;
      agents = found.agents;
      agentPicker.replaceChildren(...agents.map(a => el('option', { value: a.id }, `${a.icon} ${a.name}`)));
      providerPicker.replaceChildren(...settings.config.providers.map(p => el('option', { value: p.id }, p.label || p.id)));
      const id = agents.some(a => a.id === selectedAgent) ? selectedAgent : agents[0]?.id;
      if (id !== selectedAgent) { await selectAgent(id ?? ''); return; }
      showAgent();
      await loadCommands();
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  function showAgent(): void {
    const a = agents.find(a => a.id === selectedAgent);
    agentPicker.value = selectedAgent ?? '';
    if (a) {
      providerPicker.value = a.provider; modelInput.value = a.model; agentChanged(a);
    }
    updateComposer();
  }

  async function loadCommands(): Promise<void> {
    const agent = selectedAgent;
    commands = [];
    if (!agent) return;
    try {
      const result = await api.listCommands(agent);
      if (selectedAgent !== agent) return;
      commands = result.commands; renderPicker();
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  async function selectAgent(id: string): Promise<void> {
    selectedAgent = id || undefined;
    query = ''; search.value = ''; input.value = '';
    sessions = []; ++listSeq;
    pickerClosed = false; commands = []; renderPicker();
    showAgent();
    await open(null);
    await Promise.all([refreshList(), loadCommands()]);
  }

  function renderPicker(): void {
    const typed = /^\/([^\s]*)$/.exec(input.value)?.[1];
    matches = typed === undefined ? [] : commands.filter(c => c.name.toLowerCase().startsWith(typed.toLowerCase()));
    commandIndex = Math.min(commandIndex, Math.max(0, matches.length - 1));
    picker.hidden = pickerClosed || typed === undefined || !matches.length;
    input.setAttribute('aria-expanded', String(!picker.hidden));
    input.setAttribute('aria-activedescendant', picker.hidden ? '' : `slash-${commandIndex}`);
    picker.replaceChildren(...matches.map((c, i) => el('button', { type: 'button', role: 'option', id: `slash-${i}`,
      class: `slash-option${i === commandIndex ? ' active' : ''}`, 'aria-selected': i === commandIndex ? 'true' : 'false',
      onclick: () => pickCommand(i) }, el('strong', {}, `/${c.name}`), el('span', {}, c.description))));
  }

  function pickCommand(index: number): void {
    if (!matches[index]) return;
    input.value = `/${matches[index].name} `;
    pickerClosed = true; renderPicker(); input.focus();
  }

  function connectorConfirm(connector: string, id: string, agentId: string, text: string): void {
    const name = agents.find(a => a.id === agentId)?.name ?? 'this agent';
    const card = el('div', { class: 'connector-confirm notice', role: 'group', 'aria-label': 'Enable connector' },
      el('p', {}, `Turn on ${connector} for ${name}?`));
    card.append(btn('Turn on', b => void guarded(async () => {
      const [settings, agent] = await Promise.all([api.getSettings(), api.getAgent(agentId)]);
      if (!settings.config.mcp.servers[connector]?.enabled) await api.patchMcp(connector, { enabled: true });
      if (agent.connectors !== null && !agent.connectors.includes(connector))
        await api.patchAgent(agentId, { connectors: [...agent.connectors, connector] });
      card.remove();
      if (currentId === id && selectedAgent === agentId) { input.value = text; await send(); }
    }, b), 'primary'), btn('Cancel', () => card.remove()));
    append(card);
  }

  // ---- sending
  async function send(): Promise<void> {
    const text = input.value.trim();
    const agentId = selectedAgent;
    if (!text || !agentId || isBusy()) return;
    sending = true;
    pickerClosed = true; renderPicker();
    updateComposer();
    let userBubble: HTMLElement | undefined;
    let id = currentId;
    const seq = loadSeq;
    try {
      if (!id) {
        id = (await api.createSession(undefined, agentId)).id;
        scheduleList();
        if (seq !== loadSeq || selectedAgent !== agentId) return;
        currentId = id;
      }
      if (messages.querySelector('.empty')) messages.replaceChildren();
      live = null;
      userBubble = bubble('user', text).root;
      input.value = '';
      input.style.height = '';
      running.add(id);
      await api.sendMessage(id, text);
      scheduleList();
    } catch (e) {
      const connector = e instanceof ApiError && e.status === 409 ? e.connector : undefined;
      if (id && (!(e instanceof ApiError && e.status === 409) || connector)) running.delete(id);
      userBubble?.remove();
      if (seq === loadSeq && selectedAgent === agentId) {
        if (userBubble) input.value = text;
        if (connector && id) connectorConfirm(connector, id, agentId, text);
        else toast(errMsg(e), 'error');
      }
    } finally {
      sending = false;
      updateComposer();
    }
  }

  async function stop(): Promise<void> {
    if (!currentId) return;
    const id = currentId;
    await guarded(() => api.interrupt(id), stopBtn);
  }

  // ---- events
  function onEvent(e: ApiEvent): void {
    if (e.type === 'notification') {
      const text = e.body ? `${e.title}: ${e.body}` : e.title;
      if (e.sessionId) {
        notifications.set(e.sessionId, [...notifications.get(e.sessionId) ?? [], text]);
        if (e.sessionId === currentId) note(text);
      }
      toast(text); return;
    }
    if (e.type === 'session_updated') {
      scheduleList();
      if (e.sessionId === currentId && !running.has(e.sessionId) && !sending) void reloadCurrent();
      return;
    }
    const id = e.sessionId;
    if (e.type === 'run_start') { running.add(id); scheduleList(); }
    else if (e.type !== 'run_end') running.add(id); // self-heals a missed run_start
    if (e.type === 'approval_request') {
      const a: Approval = { sessionId: id, tool: e.tool, input: e.input, state: 'pending' };
      approvals.set(e.approvalId, a);
      if (id === currentId) { a.card = approvalCard(e.approvalId, a); append(a.card); }
      else toast(`Approval needed for ${e.tool} in another chat`);
      renderList();
    } else if (e.type === 'approval_result') {
      const a = approvals.get(e.approvalId);
      if (a) { a.state = e.allowed ? 'allowed' : 'denied'; settleCard(a); renderList(); }
    } else if (e.type === 'run_end') {
      running.delete(id);
      for (const [k, a] of approvals) if (a.sessionId === id) approvals.delete(k);
      renderList();
    }
    if (id !== currentId) return;

    switch (e.type) {
      case 'run_start': live = null; break;
      case 'text_delta': {
        const l = (live ??= bubble('assistant', ''));
        l.text += e.text;
        keepBottom(() => renderText(l.body, l.text));
        break;
      }
      case 'tool_start': live = null; addToolRow(e.callId, e.name, e.input); break;
      case 'tool_end': tools.get(e.callId)?.finish(e.isError, e.output); break;
      case 'compaction': note(`Earlier messages were summarised (${e.removedMessages} removed).`); break;
      case 'run_end': {
        live = null;
        void reloadCurrent().then(() => {
          if (currentId !== id) return;
          if (e.status === 'interrupted') note('Stopped.');
          else if (e.status === 'max_turns') note('Stopped at the turn limit. Send another message to continue.', 'warn');
          else if (e.status === 'error') note(e.error ? `Error: ${e.error}` : 'The run failed.', 'error');
        });
        break;
      }
    }
    updateComposer();
  }

  // ---- wiring
  let searchTimer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => { query = search.value.trim(); void refreshList(); }, 250);
  });
  input.addEventListener('keydown', (ev) => {
    if (!picker.hidden && !ev.isComposing) {
      if (ev.key === 'Escape') { ev.preventDefault(); pickerClosed = true; renderPicker(); return; }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault(); commandIndex = (commandIndex + (ev.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; renderPicker(); return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') { ev.preventDefault(); pickCommand(commandIndex); return; }
    }
    if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); void send(); }
  });
  input.addEventListener('input', () => {
    pickerClosed = false; commandIndex = 0; renderPicker();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
  });

  agentPicker.addEventListener('change', () => void selectAgent(agentPicker.value));
  void refreshAgents();
  void open(null);

  return {
    root,
    onEvent,
    refreshAgents,
    selectAgent,
    agentId: () => selectedAgent,
    leave: () => { ++loadSeq; },
    onStreamOpen() {
      running.clear();
      for (const a of approvals.values()) a.card?.remove();
      approvals.clear();
      renderList();
      updateComposer();
    },
    refresh() {
      void refreshList();
      void reloadCurrent();
      updateComposer();
    },
  };
}
