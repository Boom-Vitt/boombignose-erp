// Chat: the agent switcher and chat list (placed in the sidebar by main.ts), the conversation with its streaming answer,
// one-line tool rows, approval cards, error cards, and the composer.
import { ApiError } from './api.ts';
import type { Api } from './api.ts';
import type { Agent, ApiEvent, Command, Config, LiveTurn, Message, Notice, SessionSummary } from './types.ts';
import { appIcon, avatar, badge, btn, confirmDialog, copyText, el, errMsg, guarded, icon, renderText, select, sessionGroup, setLang, th, toast } from './dom.ts';

export interface Chat {
  /** The conversation (header, messages, composer). */
  root: HTMLElement;
  /** Sidebar parts: the agent switcher on top, the grouped chat list below. */
  agentSwitch: HTMLElement;
  sidebar: HTMLElement;
  onEvent(e: ApiEvent): void;
  /** Clear stale event state before the new stream's replay is read. */
  onStreamOpen(): void;
  /** Reload the list and the open chat, e.g. after the event stream reconnects. */
  refresh(): void;
  refreshAgents(): Promise<void>;
  selectAgent(id: string): Promise<void>;
  agentId(): string | undefined;
  leave(): void;
  /** A blank chat with the current agent. */
  newChat(): void;
  /** True while the open chat is the blank one. */
  isEmpty(): boolean;
  /** Show the chat search row and focus it (Cmd+F). */
  focusSearch(): void;
  /** False while the event stream is down: the composer cannot send. */
  setOnline(online: boolean): void;
  /** Esc denies the newest pending approval of the open chat. */
  onKey(ev: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault'>): void;
}

type Part = Node | string;
interface Approval {
  sessionId: string; tool: string; input: Record<string, unknown>; state: 'pending' | 'allowed' | 'denied';
  card?: HTMLElement; row?: ToolRow; callId?: string; decide?: (allow: boolean) => void; focus?: () => void;
}
interface ToolRow { root: HTMLElement; callId: string; name: string; done: boolean; startedAt?: number; finish(isError: boolean, output: string): void }
interface Live { root: HTMLElement; body: HTMLElement; text: string; hint: HTMLElement | null }
export interface ToolLine { icon: string; running: Part[]; done(output: string): Part[]; failed: Part[]; arg?: string }

const pretty = (v: unknown) => JSON.stringify(v, null, 2);
const SUMMARY_PREFIX = '[Summary of earlier conversation]';
const GROUPS = ['Today', 'Yesterday', 'Previous 7 days', 'Older'] as const;
const STARTERS = ['สรุปไฟล์ในโฟลเดอร์งาน', 'ร่างคำตอบลูกค้าใน LINE', 'Plan my week'];
const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])/;

const last = (path: string) => path.split('/').filter(Boolean).pop() ?? '';
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const lines = (out: string) => out.split('\n').filter((l) => l.trim()).length;
const code = (text: string) => el('code', {}, text);
const strong = (text: string) => el('strong', { lang: th(text) }, text);

/** The one map from a tool call to its plain sentence. Unknown tools (MCP, connectors) keep their raw id, so nothing is hidden. */
export function toolLine(name: string, input: Record<string, unknown>, workspace = ''): ToolLine {
  const s = (k: string) => (typeof input[k] === 'string' ? input[k] : '');
  const folder = last(s('path')) || last(workspace) || 'the work folder';
  const file = last(s('path')) || 'a file';
  switch (name) {
    case 'list_files': return { icon: 'folder', running: [`Looking in ${folder}…`], done: (o) => [`Looked at ${plural(lines(o), 'item')} in ${folder}`], failed: [`Couldn't look in ${folder}`] };
    case 'read_file': return { icon: 'file', running: [`Reading ${file}…`], done: () => [`Read ${file}`], failed: [`Couldn't read ${file}`] };
    case 'search_files': {
      const q = s('pattern');
      return { icon: 'search', running: [`Searching for “${q}”…`], done: (o) => [`Found ${plural(lines(o), 'match', 'matches')} for “${q}”`], failed: [`Couldn't search for “${q}”`] };
    }
    case 'write_file': return { icon: 'pencil', running: [`Writing ${file}…`], done: () => [`Wrote ${file}`], failed: [`Couldn't write ${file}`] };
    case 'edit_file': return { icon: 'pencil', running: [`Editing ${file}…`], done: () => [`Edited ${file}`], failed: [`Couldn't edit ${file}`] };
    case 'shell': { const c = s('command'); return { icon: 'term', running: ['Running ', code(c), '…'], done: () => ['Ran ', code(c)], failed: ["Couldn't run ", code(c)] }; }
    case 'web_fetch': {
      let host = s('url');
      try { host = new URL(host).host; } catch { /* show the text as given */ }
      return { icon: 'globe', running: [`Opening ${host}…`], done: () => [`Opened ${host}`], failed: [`Couldn't open ${host}`] };
    }
    case 'delegate': return { icon: 'agents', running: ['Asking a helper…'], done: () => ['A helper answered'], failed: ["The helper didn't answer"] };
    case 'skill_load': { const n = s('name') || 'a skill'; return { icon: 'book', running: [`Loading ${n}…`], done: () => [`Used skill ${n}`], failed: [`Couldn't load ${n}`] }; }
    case 'memory_read': return { icon: 'book', running: ['Reading notes…'], done: () => ['Read notes'], failed: ["Couldn't read notes"] };
    case 'memory_write': return { icon: 'book', running: ['Saving a note…'], done: () => ['Saved a note'], failed: ["Couldn't save a note"] };
    default: {
      const id = () => el('code', { class: 'tool-id' }, name);
      return { icon: 'wrench', running: [id()], done: () => [id()], failed: [id()], arg: Object.values(input).find((v): v is string => typeof v === 'string')?.slice(0, 80) };
    }
  }
}

/** The title, one sentence and the command line an approval card shows for a tool. */
function approvalText(tool: string, input: Record<string, unknown>, workspace: string): { title: Part[]; desc: Part[]; cmd: string; command: boolean } {
  const s = (k: string) => (typeof input[k] === 'string' ? input[k] : '');
  const folder = last(workspace);
  switch (tool) {
    case 'shell': return {
      title: ['Run this command?'], cmd: s('command'), command: true,
      desc: ['BigNose wants to run it', ...(folder ? [' in ', strong(folder)] : []), `. It can change files${folder ? ' in that folder' : ''}.`],
    };
    case 'write_file': return { title: ['Change this file?'], desc: ['BigNose wants to write this file. It replaces what is there.'], cmd: s('path'), command: false };
    case 'edit_file': return { title: ['Change this file?'], desc: ['BigNose wants to edit this file.'], cmd: s('path'), command: false };
    case 'web_fetch': return { title: ['Open this web page?'], desc: ['BigNose wants to read this page from the internet.'], cmd: s('url'), command: false };
    default: return { title: ['Use ', code(tool), '?'], desc: ['BigNose wants to use this tool.'], cmd: pretty(input), command: false };
  }
}

/** Plain cause and one fix for a failed run (the raw error stays behind "Show details"). */
function explain(raw: string, model: string, local: boolean): { title: string; desc: Part[] } {
  if (/\b40[13]\b|unauthori[sz]ed|invalid api key/i.test(raw)) return { title: 'The cloud service refused the key', desc: ['Check the API key in Settings › Model.'] };
  if (/ECONNREFUSED|connection refused|fetch failed|ENOTFOUND/i.test(raw))
    return local ? { title: "Ollama isn't running", desc: ['Open Ollama, then try again.'] } : { title: "Couldn't reach the model service", desc: ['Check your internet connection, then try again.'] };
  if (/\b404\b/.test(raw))
    return local ? { title: `${model} isn't on this Mac`, desc: ['Run ', code(`ollama pull ${model}`), ', or pick another model.'] }
      : { title: "That model isn't available", desc: ['Pick another model in Settings › Model.'] };
  if (/\b5\d\d\b/.test(raw))
    return { title: "The model didn't answer", desc: [local ? 'Ollama returned an error. Make sure it is still running, then try again.' : 'The service returned an error. Try again in a moment.'] };
  return { title: 'Something went wrong', desc: [raw.split('\n')[0]!.slice(0, 200)] };
}

export function createChat(api: Api, agentChanged: (agent: Agent) => void = () => {}, viewChanged: () => void = () => {}): Chat {
  let agents: Agent[] = [];
  let config: Config | null = null;
  let selectedAgent: string | undefined;
  let agentSeq = 0;
  let commands: Command[] = [];
  let matches: Command[] = [];
  let commandIndex = 0;
  let pickerClosed = false;
  const notifications = new Map<string, string[]>();
  let currentId: string | null = null;
  let loadSeq = 0;
  let historyLoadSeq = 0;
  let listSeq = 0;
  let query = '';
  let searchOpen = false;
  let sending = false;
  let offline = false;
  let shownBusy = false;
  let alertSeq = 0;
  let lastUser = ''; // the newest user message of the open chat, for "Try again"
  let listTimer = 0;
  let live: Live | null = null;
  let reading: ApiEvent[] | null = null; // text and tool events of the open chat that come in while its history is being read
  let seen: { runId: string; seq: number } | null = null; // the newest numbered event already on screen
  const runErrors = new Map<string, string>(); // run_end error per chat, shown when no stored note says it (see renderHistory)
  const running = new Set<string>();
  const approvals = new Map<string, Approval>();
  const tools = new Map<string, ToolRow>();
  let sessions: SessionSummary[] = [];

  // ---- DOM
  const agentPicker = select([], '');
  agentPicker.setAttribute('aria-label', 'Chat agent');
  const avatarSlot = el('span', { class: 'avatar-slot' });
  const agentSwitch = el('label', { class: 'agent-switch' }, avatarSlot, agentPicker);
  const search = el('input', { type: 'search', placeholder: 'Search chats', 'aria-label': 'Search chats', autocomplete: 'off', hidden: true });
  const listHost = el('div');
  const sidebar = el('aside', { class: 'sessions', 'aria-label': 'Chats' }, search, listHost);
  const title = el('h1', { class: 'chat-title' }, 'New chat');
  const modelLink = el('a', { class: 'model-link', href: '#/settings/model', hidden: true });
  const messages = el('div', { class: 'messages', role: 'log', 'aria-live': 'polite', 'aria-label': 'Conversation' });
  const picker = el('div', { id: 'slash-picker', class: 'slash-picker', role: 'listbox', 'aria-label': 'Slash commands', hidden: true });
  const input = el('textarea', { rows: 1, placeholder: 'Message BigNose', 'aria-label': 'Message', 'aria-autocomplete': 'list', 'aria-controls': 'slash-picker', 'aria-expanded': 'false' });
  const sendBtn = el('button', { type: 'button', class: 'send' }, icon('up'), el('span', { class: 'sr-only' }, 'Send'));
  const root = el('section', { class: 'chat', 'aria-label': 'Chat' },
    el('header', { class: 'chat-head' }, title, modelLink),
    messages,
    el('div', { class: 'composer' }, picker, el('div', { class: 'composer-box' }, input, sendBtn)));

  // ---- helpers
  const isBusy = () => sending || (currentId !== null && running.has(currentId));
  const workspace = () => config?.agent.workspace ?? '';
  const agentOf = (id = selectedAgent) => agents.find((a) => a.id === id);
  const titleOf = (id: string) => sessions.find((s) => s.id === id)?.title || 'another chat';

  function updateComposer(): void {
    const busy = isBusy();
    if (busy !== shownBusy) { // one button: Send and Stop swap class and icon, so nothing jumps
      shownBusy = busy;
      sendBtn.className = busy ? 'send stop' : 'send';
      sendBtn.replaceChildren(icon(busy ? 'stop' : 'up'), el('span', { class: 'sr-only' }, busy ? 'Stop' : 'Send'));
      sendBtn.disabled = false;
    }
    if (!busy) sendBtn.disabled = !selectedAgent || offline || !input.value.trim();
  }

  function append(node: Node): void {
    const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    messages.querySelector('.empty')?.remove(); // real content replaces the empty state
    messages.appendChild(node);
    if (stick) messages.scrollTop = messages.scrollHeight;
  }

  function keepBottom(fn: () => void): void {
    const stick = messages.scrollHeight - messages.scrollTop - messages.clientHeight < 80;
    fn();
    if (stick) messages.scrollTop = messages.scrollHeight;
  }

  function bubble(role: 'user' | 'assistant', text: string, thinking = false): Live {
    const body = el('div', { class: 'msg-body' });
    renderText(body, text);
    const hint = thinking ? el('span', { class: 'sr-only' }, 'Thinking') : null;
    const root = el('div', { class: `msg ${role}` }, hint, body);
    append(root);
    return { root, body, text, hint };
  }

  /** The assistant bubble that is receiving text carries the caret (`.streaming`). */
  function setLive(l: Live | null): void {
    live?.root.classList.toggle('streaming', false);
    live = l;
    l?.root.classList.toggle('streaming', true);
  }

  function startLive(): Live {
    const l = bubble('assistant', '');
    setLive(l);
    return l;
  }

  /** The answer stops here (a tool starts or the run ends): an empty bubble goes away, a written one loses its caret. */
  function endLive(): void {
    if (live && !live.text) live.root.remove();
    setLive(null);
  }

  const note = (text: string, tone = '') => append(el('div', { class: `note ${tone}`.trim(), lang: th(text) }, text));

  function errorCard(text: string, at: number, latest: boolean): void {
    const agent = agentOf();
    const provider = config?.providers.find((p) => p.id === agent?.provider);
    const raw = text.replace(/^Error:\s*/, '');
    const cause = explain(raw, agent?.model ?? 'The model', LOOPBACK.test(provider?.baseUrl ?? ''));
    const diagnostics = `${raw}\n${[agent?.model, provider?.baseUrl, new Date(at).toLocaleTimeString('en-GB')].filter(Boolean).join(' · ')}`;
    const moreId = `err-more-${++alertSeq}`;
    const copy = el('button', { type: 'button', class: 'btn small' }, icon('copy'), 'Copy diagnostics');
    copy.addEventListener('click', () => copyText(diagnostics));
    const more = el('div', { class: 'alert-more', id: moreId, hidden: true }, el('pre', { lang: th(diagnostics) }, diagnostics), copy);
    const toggle = el('button', { type: 'button', class: 'btn quiet', 'aria-expanded': 'false', 'aria-controls': moreId }, 'Show details');
    toggle.addEventListener('click', () => {
      more.hidden = !more.hidden;
      toggle.setAttribute('aria-expanded', String(!more.hidden));
      toggle.textContent = more.hidden ? 'Show details' : 'Hide details';
    });
    append(el('div', { class: 'alert', role: 'alert' },
      el('span', { class: 'alert-icon', 'aria-hidden': 'true' }, icon('x')),
      el('div', {}, el('p', { class: 'alert-title' }, cause.title), el('p', { class: 'alert-desc' }, ...cause.desc)),
      el('div', { class: 'alert-actions' }, latest && btn('Try again', () => { if (lastUser && !isBusy()) void send(lastUser); }, 'primary'), toggle),
      more));
  }

  function toolRow(callId: string, name: string, input: Record<string, unknown>): ToolRow {
    const line = toolLine(name, input, workspace());
    const label = el('span', { class: 'tool-name' }, ...line.running);
    const meta = el('span', { class: 'tool-meta' });
    const status = el('span', { class: 'tool-status running' }, el('span', { class: 'spin', 'aria-hidden': 'true' }), el('span', { class: 'sr-only' }, 'Running'));
    const out = el('pre', { class: 'tool-out' });
    const inputText = pretty(input);
    const row = el('details', { class: 'tool' },
      el('summary', {}, icon('chev-r', 'chev'), icon(line.icon), label, line.arg && el('span', { class: 'tool-arg', lang: th(line.arg) }, line.arg), meta, status),
      el('div', { class: 'tool-body' },
        el('div', { class: 'tool-label' }, 'Input'), el('pre', { lang: th(inputText) }, inputText),
        el('div', { class: 'tool-label' }, 'Result'), out));
    setLang(label, label.textContent ?? '');
    return {
      root: row, callId, name, done: false,
      finish(isError, output) {
        this.done = true;
        status.className = `tool-status ${isError ? 'error' : 'done'}`;
        status.replaceChildren(icon(isError ? 'x' : 'check'), el('span', { class: 'sr-only' }, isError ? 'Failed' : 'Done'));
        label.replaceChildren(...(isError ? line.failed : line.done(output)));
        setLang(label, label.textContent ?? '');
        out.textContent = output || '(no output)';
        setLang(out, output);
        if (this.startedAt !== undefined) meta.textContent = `${((Date.now() - this.startedAt) / 1000).toFixed(1)} s`;
        if (isError) row.open = true; // a failure opens itself
      },
    };
  }

  function addToolRow(callId: string, name: string, input: Record<string, unknown>): ToolRow | undefined {
    if (tools.get(callId)?.done === false) return undefined; // already on screen and running (restored from history or from the live turn); a finished call's id may come back in a later turn
    const row = toolRow(callId, name, input);
    tools.set(callId, row);
    append(row.root);
    return row;
  }

  const findRunning = (tool: string) => [...tools.values()].reverse().find((r) => r.name === tool && !r.done);

  /** What the card shows after a decision: one line that stays in the history. */
  function receipt(a: Approval, card: HTMLElement = el('div')): HTMLElement {
    const what = ['shell', 'write_file', 'edit_file', 'web_fetch'].includes(a.tool) ? approvalText(a.tool, a.input, workspace()).cmd : a.tool;
    for (const attr of ['role', 'aria-labelledby', 'aria-describedby']) card.removeAttribute(attr);
    card.className = `approval ${a.state}`;
    card.replaceChildren(icon(a.state === 'allowed' ? 'check' : 'x'), a.state === 'allowed' ? 'You allowed once: ' : 'You denied: ', el('code', { lang: th(what) }, what));
    return card;
  }

  function approvalCard(id: string, a: Approval): HTMLElement {
    const t = approvalText(a.tool, a.input, workspace());
    const status = el('span', { class: 'approval-status' });
    const allow = btn('Allow once', () => decide(true), 'primary');
    const deny = btn('Deny', () => decide(false), 'kbd-esc');
    deny.setAttribute('aria-keyshortcuts', 'Escape');
    const decide = (ok: boolean) => {
      if (allow.disabled) return;
      allow.disabled = deny.disabled = true;
      api.decideApproval(id, ok).then(() => { status.textContent = 'Sent…'; }, (e) => {
        if (e instanceof ApiError && e.status === 404) { status.textContent = 'Already decided'; return; }
        allow.disabled = deny.disabled = false;
        toast(errMsg(e), 'error');
      });
    };
    a.decide = decide;
    a.focus = () => { if (!input.value.trim() || document.activeElement === document.body) deny.focus(); }; // never steal focus from typing
    const titleId = `approval-title-${id}`, descId = `approval-desc-${id}`;
    return el('div', { class: 'approval', role: 'group', 'aria-labelledby': titleId, 'aria-describedby': descId },
      el('div', {}, el('p', { class: 'approval-title', id: titleId }, ...t.title), el('p', { class: 'approval-desc', id: descId }, ...t.desc)),
      el('pre', { class: `approval-cmd${t.command ? ' command' : ''}`, lang: th(t.cmd) }, code(t.cmd)),
      el('div', { class: 'approval-actions' }, deny, allow, status));
  }

  /** The card is the tool: it goes in front of the (hidden) running row, so the receipt later reads before the result. */
  function place(card: Node, row?: ToolRow): void {
    if (row) keepBottom(() => row.root.before(card)); else append(card);
  }

  function settleCard(a: Approval): void {
    if (a.card) receipt(a, a.card);
  }

  function showApprovals(): void {
    let newest: Approval | undefined;
    for (const [id, a] of approvals) {
      if (a.sessionId !== currentId) continue;
      a.row = (a.callId ? tools.get(a.callId) : undefined) ?? (a.state === 'pending' ? findRunning(a.tool) : undefined);
      if (a.state === 'pending') { if (a.row) a.row.root.hidden = true; a.card = approvalCard(id, a); newest = a; }
      else a.card = receipt(a);
      place(a.card, a.row);
    }
    newest?.focus?.();
  }

  function renderHistory(msgs: Message[], notices: Notice[] = [], turn?: LiveTurn | null): void {
    historyLoadSeq = 0;
    messages.replaceChildren();
    tools.clear();
    live = null;
    lastUser = '';
    if (!msgs.length) messages.appendChild(emptyState());
    let next = 0;
    const show = (n: Notice) => (n.level === 'error' ? errorCard(n.text, n.at, n.after >= msgs.length) : note(n.text, n.level === 'info' ? '' : n.level));
    const notesBefore = (index: number) => { for (; next < notices.length && notices[next]!.after <= index; next++) show(notices[next]!); };
    msgs.forEach((m, i) => {
      notesBefore(i);
      for (const b of m.content) {
        if (b.type === 'text') {
          if (!b.text.trim()) continue;
          if (b.text.startsWith(SUMMARY_PREFIX)) note('Earlier messages were summarised to save space.');
          else { bubble(m.role, b.text); if (m.role === 'user') lastUser = b.text; }
        } else if (b.type === 'tool_use') addToolRow(b.id, b.name, b.input);
        else if (b.type === 'tool_result') tools.get(b.toolUseId)?.finish(!!b.isError, b.content);
      }
    });
    notesBefore(Infinity);
    for (const text of notifications.get(currentId ?? '') ?? []) note(text);
    const failed = currentId && runErrors.get(currentId);
    if (failed && !notices.some(n => n.text === failed)) errorCard(failed, Date.now(), true); // the daemon could not store it
    seen = turn && turn.seq !== undefined ? { runId: turn.runId, seq: turn.seq } : null;
    if (turn) { // a run in progress: later deltas and tool_end events carry on in this bubble and these rows
      if (turn.text || !turn.tools.length) setLive(bubble('assistant', turn.text, !turn.text));
      for (const t of turn.tools) {
        addToolRow(t.callId, t.name, t.input);
        if (t.done) tools.get(t.callId)!.finish(!!t.isError, t.output ?? '');
      }
    } else if (turn === null) { // no run is going: a call without a result was cut short (a crash or kill), it is not still running
      for (const row of tools.values()) if (!row.done) row.finish(true, 'Interrupted: the run did not finish.');
    }
    messages.scrollTop = messages.scrollHeight;
  }

  function emptyState(): HTMLElement {
    const a = agentOf();
    const starters = STARTERS.map((text) => el('button', { type: 'button', class: 'chip', lang: th(text), onclick: () => { input.value = text; onInput(); input.focus(); } }, text));
    return el('div', { class: 'empty' }, appIcon(), el('h2', {}, 'How can I help?'),
      el('p', { class: 'muted' }, ...(a ? ["You're chatting with ", strong(a.name), ` on ${a.model}. `] : []), 'It asks before it runs commands or changes files.'),
      el('div', { class: 'starters' }, ...starters));
  }

  // ---- sessions
  function showHeader(): void {
    const t = (currentId && sessions.find((s) => s.id === currentId)?.title) || 'New chat';
    title.textContent = t;
    setLang(title, t);
    const a = agentOf();
    modelLink.hidden = !a;
    if (a) {
      modelLink.setAttribute('aria-label', `Model ${a.model}. Change in Settings`);
      modelLink.replaceChildren(a.model, icon('chev-r'));
    }
  }

  function sessionItem(s: SessionSummary): HTMLElement {
    const active = s.id === currentId;
    const waiting = [...approvals.values()].some((a) => a.sessionId === s.id && a.state === 'pending');
    const name = s.title || 'New chat';
    const more = el('button', { type: 'button', class: 'icon-btn', 'aria-label': `Delete ${name}`, title: 'Delete chat' }, icon('more'));
    more.addEventListener('click', () => {
      void confirmDialog({ title: `Delete “${name}”?`, body: 'The chat and its messages are deleted.', action: 'Delete' }).then((ok) => ok && guarded(async () => {
        await api.deleteSession(s.id);
        if (currentId === s.id) await open(null);
        await refreshList();
      }));
    });
    return el('li', { class: 'session-item' },
      el('button', { type: 'button', class: 'session', 'aria-current': active ? 'true' : undefined, onclick: () => void open(s.id) },
        el('span', { class: 'session-title', lang: th(name) }, name),
        running.has(s.id) && el('span', { class: 'dot', 'aria-hidden': 'true' }), running.has(s.id) && el('span', { class: 'sr-only' }, 'Running'),
        waiting && badge('Waiting', 'warn')),
      more);
  }

  function renderList(): void {
    const parts: Node[] = [];
    for (const group of GROUPS) {
      const items = sessions.filter((s) => sessionGroup(s.updatedAt) === group);
      if (items.length) parts.push(el('div', { class: 'session-group' }, group), el('ul', { class: 'session-list' }, ...items.map(sessionItem)));
    }
    if (!sessions.length) parts.push(el('ul', { class: 'session-list' }, el('li', { class: 'session-empty' }, query ? 'No chats match.' : 'No chats yet.')));
    listHost.replaceChildren(...parts);
    search.hidden = !(sessions.length > 8 || searchOpen || query);
    showHeader();
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
      listHost.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, errMsg(e)));
    }
  }

  function scheduleList(): void {
    window.clearTimeout(listTimer);
    listTimer = window.setTimeout(() => void refreshList(), 250);
  }

  async function open(id: string | null): Promise<void> {
    currentId = id;
    reading = null; // an older read that is still pending must not hold this chat's events
    const seq = ++loadSeq;
    renderList();
    updateComposer();
    viewChanged();
    if (!id) { renderHistory([]); return; }
    historyLoadSeq = seq;
    messages.replaceChildren(el('p', { class: 'muted loading' }, 'Loading…'));
    try {
      await readHistory(id, seq, false);
    } catch (e) {
      if (seq !== loadSeq) return;
      historyLoadSeq = 0;
      messages.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void open(id))));
    }
  }

  async function reloadCurrent(): Promise<void> {
    const id = currentId;
    if (!id) return;
    const seq = ++loadSeq;
    try {
      await readHistory(id, seq, true);
    } catch (e) {
      toast(errMsg(e), 'error');
    }
  }

  async function readHistory(id: string, seq: number, historyOnScreen: boolean): Promise<void> {
    // Text and tool events that arrive during the read are held back and replayed after the render; the numbered ones the answer
    // already includes are dropped by the `seen` check in onEvent, so nothing is lost and nothing is shown twice.
    const held: ApiEvent[] = reading = [];
    const current = () => seq === loadSeq && id === currentId;
    let rendered = false;
    try {
      const s = await api.getSession(id);
      if (!current()) return;
      renderHistory(s.messages, s.notices, s.live);
      rendered = true;
      showApprovals();
    } finally {
      if (reading === held) reading = null;
      // after the render, or after a failed reload of a history that is still on screen; a failed first open shows "Loading…", not a chat
      if (current() && (rendered || historyOnScreen)) for (const e of held) onEvent(e);
    }
  }

  // ---- agents and commands
  async function refreshAgents(): Promise<void> {
    const seq = ++agentSeq;
    const loadAtStart = loadSeq;
    try {
      const [found, settings] = await Promise.all([api.listAgents(), api.getSettings()]);
      if (seq !== agentSeq) return;
      agents = found.agents;
      config = settings.config;
      agentPicker.replaceChildren(...agents.map(a => el('option', { value: a.id, lang: th(a.name) }, a.name)));
      const id = agents.some(a => a.id === selectedAgent) ? selectedAgent : agents[0]?.id;
      if (id !== selectedAgent) { await selectAgent(id ?? ''); return; }
      showAgent();
      await loadCommands();
      // Resume only an invalidated load, and only if this return is still current.
      if (seq === agentSeq && loadAtStart === loadSeq && historyLoadSeq && historyLoadSeq !== loadSeq) await open(currentId);
    } catch (e) { toast(errMsg(e), 'error'); }
  }

  function showAgent(): void {
    const a = agentOf();
    agentPicker.value = selectedAgent ?? '';
    avatarSlot.replaceChildren(...(a ? [avatar(a, 'sm')] : []));
    if (a) agentChanged(a);
    showHeader();
    if (!currentId && messages.querySelector('.empty')) messages.replaceChildren(emptyState()); // names the agent and its model
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
    pickerClosed = true; renderPicker(); updateComposer(); input.focus();
  }

  function connectorConfirm(connector: string, id: string, agentId: string, text: string): void {
    const name = agents.find(a => a.id === agentId)?.name ?? 'this agent';
    const titleId = `connector-title-${++alertSeq}`;
    const card = el('div', { class: 'connector-confirm', role: 'group', 'aria-labelledby': titleId },
      el('p', { class: 'approval-title', id: titleId }, `Turn on ${connector} for `, el('span', { lang: th(name) }, name), '?'));
    card.append(el('div', { class: 'approval-actions' }, btn('Not now', () => card.remove()), btn('Turn on', b => void guarded(async () => {
      const [settings, agent] = await Promise.all([api.getSettings(), api.getAgent(agentId)]);
      if (!settings.config.mcp.servers[connector]?.enabled) await api.patchMcp(connector, { enabled: true });
      if (agent.connectors !== null && !agent.connectors.includes(connector))
        await api.patchAgent(agentId, { connectors: [...agent.connectors, connector] });
      card.remove();
      if (currentId === id && selectedAgent === agentId) { input.value = text; await send(); }
    }, b), 'primary')));
    append(card);
  }

  // ---- sending
  /** Sends the composer's text, or `again` (Try again) without touching the composer. */
  async function send(again?: string): Promise<void> {
    const text = (again ?? input.value).trim();
    const agentId = selectedAgent;
    if (!text || !agentId || isBusy() || offline) return;
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
        viewChanged();
      }
      if (messages.querySelector('.empty')) messages.replaceChildren();
      setLive(null);
      userBubble = bubble('user', text).root;
      lastUser = text;
      if (again === undefined) { input.value = ''; input.style.height = ''; }
      running.add(id);
      await api.sendMessage(id, text);
      scheduleList();
    } catch (e) {
      const connector = e instanceof ApiError && e.status === 409 ? e.connector : undefined;
      if (id && (!(e instanceof ApiError && e.status === 409) || connector)) running.delete(id);
      userBubble?.remove();
      if (seq === loadSeq && selectedAgent === agentId) {
        if (userBubble && again === undefined) input.value = text;
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
    await guarded(() => api.interrupt(id), sendBtn);
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
    if (e.type === 'run_start') { running.add(id); runErrors.delete(id); scheduleList(); }
    else if (e.type !== 'run_end') running.add(id); // self-heals a missed run_start
    if (e.type === 'approval_request') {
      const a: Approval = { sessionId: id, tool: e.tool, input: e.input, state: 'pending' };
      approvals.set(e.approvalId, a);
      if (id === currentId) {
        a.row = findRunning(e.tool); // the card IS that tool: hide its running row until it is decided
        if (a.row) { a.row.root.hidden = true; a.callId = a.row.callId; }
        a.card = approvalCard(e.approvalId, a);
        place(a.card, a.row);
        a.focus?.();
      } else toast(`BigNose is waiting for you in ${titleOf(id)}`);
      renderList();
    } else if (e.type === 'approval_result') {
      const a = approvals.get(e.approvalId);
      if (a) {
        a.state = e.allowed ? 'allowed' : 'denied';
        if (a.row) { a.row.root.hidden = false; if (a.row.startedAt !== undefined) a.row.startedAt = Date.now(); } // the wait is not the tool's time
        settleCard(a); renderList();
      }
    } else if (e.type === 'run_end') {
      running.delete(id);
      if (e.status === 'error' && e.error) runErrors.set(id, `Error: ${e.error}`);
      for (const [k, a] of approvals) if (a.sessionId === id && a.state === 'pending') approvals.delete(k); // decided ones stay as receipts
      renderList();
    }
    if (id !== currentId) return;
    if (e.type === 'text_delta' || e.type === 'tool_start' || e.type === 'tool_end') {
      if (reading) { reading.push(e); return; }
      if (e.seq !== undefined) {
        if (seen?.runId === e.runId && e.seq <= seen.seq) return; // the snapshot on screen already includes it
        seen = { runId: e.runId, seq: e.seq };
      }
    }

    switch (e.type) {
      case 'run_start':
        endLive();
        if (!reading) setLive(bubble('assistant', '', true)); // a read in flight draws the live turn from its own snapshot
        break;
      case 'text_delta': {
        const l = live ?? startLive();
        l.text += e.text;
        l.hint?.remove(); l.hint = null;
        keepBottom(() => renderText(l.body, l.text));
        break;
      }
      case 'tool_start': {
        endLive();
        const row = addToolRow(e.callId, e.name, e.input);
        if (row) row.startedAt = Date.now();
        break;
      }
      case 'tool_end': tools.get(e.callId)?.finish(e.isError, e.output); break;
      case 'compaction': note(`Earlier messages were summarised (${e.removedMessages} removed).`); break;
      case 'run_end': // the outcome note is stored with the session, so the reload brings it back in place
        endLive();
        void reloadCurrent();
        break;
    }
    updateComposer();
  }

  // ---- wiring
  function onInput(): void {
    pickerClosed = false; commandIndex = 0; renderPicker();
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 200)}px`;
    updateComposer();
  }

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
  input.addEventListener('input', onInput);
  sendBtn.addEventListener('click', () => void (isBusy() ? stop() : send()));

  agentPicker.addEventListener('change', () => void selectAgent(agentPicker.value));
  void refreshAgents();
  void open(null);

  return {
    root, agentSwitch, sidebar,
    onEvent,
    refreshAgents,
    selectAgent,
    agentId: () => selectedAgent,
    leave: () => { ++loadSeq; },
    newChat() { void open(null); input.focus(); },
    isEmpty: () => currentId === null,
    focusSearch() { searchOpen = true; renderList(); search.focus(); },
    setOnline(online) { offline = !online; updateComposer(); },
    onKey(ev) {
      if (ev.key !== 'Escape' || ev.defaultPrevented || root.hidden || !picker.hidden || document.querySelector('dialog[open]')) return;
      const a = [...approvals.values()].reverse().find((x) => x.sessionId === currentId && x.state === 'pending' && x.decide);
      if (a) { ev.preventDefault(); a.decide!(false); }
    },
    onStreamOpen() {
      running.clear();
      for (const [k, a] of approvals) if (a.state === 'pending') { a.card?.remove(); if (a.row) a.row.root.hidden = false; approvals.delete(k); } // the replay brings back the live ones
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
