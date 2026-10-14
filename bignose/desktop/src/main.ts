// App shell: asks the Rust side for the daemon, then wires Chat, Settings and the event stream.
import { createApi } from './api.ts';
import type { Api } from './api.ts';
import { mountAgents } from './agents.ts';
import { createChat } from './chat.ts';
import { btn, el, errMsg, toast } from './dom.ts';
import { provisionErp } from './os/erp-setup.ts';
import type { OsInfo } from './os/erp-setup.ts';
import { waitForReady } from './os/startup.ts';
import { streamEvents } from './sse.ts';
import type { ApiEvent } from './types.ts';
import { mountConnectors } from './settings/connectors.ts';
import { mountGeneral } from './settings/general.ts';
import { mountHooks } from './settings/hooks.ts';
import { mountMemory } from './settings/memory.ts';
import { mountMessaging } from './settings/messaging.ts';
import { mountProviders } from './settings/providers.ts';
import { mountSchedules } from './settings/schedules.ts';
import { mountSkills } from './settings/skills.ts';

interface DaemonInfo { port: number; token: string; spawned: boolean }
declare global {
  interface Window {
    __TAURI__?: { core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> } };
    /** Set by the BigNose OS window: this page is the panel beside the ERP. */
    __BIGNOSE_OS__?: boolean;
  }
}
const OS = window.__BIGNOSE_OS__ === true;

const SECTIONS: { id: string; label: string; mount: (pane: HTMLElement, api: Api) => void }[] = [
  { id: 'general', label: 'General', mount: mountGeneral },
  { id: 'providers', label: 'Providers & models', mount: mountProviders },
  { id: 'connectors', label: 'Connectors', mount: mountConnectors },
  { id: 'messaging', label: 'Messaging', mount: mountMessaging },
  { id: 'hooks', label: 'Hooks', mount: mountHooks },
  { id: 'skills', label: 'Skills', mount: mountSkills },
  { id: 'memory', label: 'Memory', mount: mountMemory },
  { id: 'schedules', label: 'Schedules', mount: mountSchedules },
];

const app = document.getElementById('app') as HTMLElement;
let events: AbortController | null = null;

const logo = () => el('div', { class: 'logo', 'aria-hidden': 'true' }, 'B');

function splash(text: string): HTMLElement {
  return el('div', { class: 'splash', role: 'status' }, logo(), el('p', {}, text));
}

function failure(message: string): HTMLElement {
  return el('div', { class: 'splash', role: 'alert' }, logo(),
    el('h1', {}, 'BigNose could not start'), el('p', { class: 'error-text' }, message),
    btn('Retry', () => void boot(), 'primary'),
    el('p', { class: 'muted' }, 'The daemon log is in ~/.bignose/logs/daemon.log.'));
}

async function boot(): Promise<void> {
  events?.abort();
  events = null;
  app.replaceChildren(splash('Starting BigNose…'));
  let api: Api;
  let erpAgent: string | undefined;
  try {
    const invoke = window.__TAURI__?.core.invoke;
    if (!invoke) throw new Error('This page only works inside the BigNose app.');
    // BigNose OS: the window shows the startup screen until the ERP answers, then this page becomes the side panel
    if (OS) await waitForReady(invoke, (view) => app.replaceChildren(view));
    const info = await invoke<DaemonInfo>('daemon_info');
    api = createApi({ port: info.port, token: info.token });
    await api.health(); // proves the token and the webview's access to the daemon
    if (OS) erpAgent = await setUpErp(api, invoke);
  } catch (e) {
    app.replaceChildren(failure(errMsg(e)));
    return;
  }
  shell(api, erpAgent);
}

/** The panel still works without the ERP assistant, so a failed setup is a message, not a stop. */
async function setUpErp(api: Api, invoke: NonNullable<Window['__TAURI__']>['core']['invoke']): Promise<string | undefined> {
  try {
    return await provisionErp(api, await invoke<OsInfo>('os_info'));
  } catch (e) {
    toast(`ERP assistant setup failed: ${errMsg(e)}`, 'error');
    return undefined;
  }
}

function panelToggle(): HTMLElement {
  const b = el('button', { type: 'button', class: 'panel-toggle', title: 'Show or hide the BigNose panel (Cmd+J)', 'aria-label': 'Show or hide the BigNose panel' },
    el('span', { class: 'toggle-open', 'aria-hidden': 'true' }, '›'), el('span', { class: 'toggle-rail', 'aria-hidden': 'true' }, '‹ BigNose'));
  b.addEventListener('click', () => { void window.__TAURI__?.core.invoke('os_toggle_panel').catch((e: unknown) => toast(errMsg(e), 'error')); });
  return b;
}

function shell(api: Api, erpAgent?: string): void {
  const model = el('div', { class: 'nav-model' });
  const chat = createChat(api, agent => { model.textContent = `${agent.name} · ${agent.provider} · ${agent.model}`; });
  const agents = el('section', { class: 'settings', 'aria-label': 'Agents' });
  const settings = el('section', { class: 'settings', 'aria-label': 'Settings' });
  const conn = el('div', { class: 'nav-conn' });
  const banner = el('div', { class: 'banner', role: 'alert', hidden: true },
    el('span', {}, 'Lost the connection to the BigNose daemon.'), btn('Retry', () => void boot(), 'small'));

  const link = (href: string, text: string) => el('a', { href, class: 'nav-link' }, text);
  const agentsLink = link('#/agents', 'Agents');
  const chatLink = link('#/chat', 'Chat');
  const sectionLinks = SECTIONS.map((s) => ({ s, a: link(`#/settings/${s.id}`, s.label) }));
  const nav = el('nav', { class: 'nav', 'aria-label': 'Main' },
    el('div', { class: 'brand' }, logo(), el('span', {}, 'BigNose')),
    chatLink, agentsLink, el('div', { class: 'nav-group' }, 'Settings'), ...sectionLinks.map((l) => l.a),
    el('div', { class: 'nav-foot' }, model, conn));

  app.replaceChildren(el('div', { class: 'shell' }, nav, el('main', { class: 'main' }, banner, chat.root, agents, settings)), ...(OS ? [panelToggle()] : []));
  document.body.classList.toggle('os-panel', OS);
  // panel mode opens on the ERP assistant; Agents and Settings stay one click away
  if (erpAgent) void chat.refreshAgents().then(() => chat.selectAgent(erpAgent));

  function route(): void {
    const id = /^#\/settings\/(\w+)/.exec(location.hash)?.[1];
    const section = SECTIONS.find((s) => s.id === id);
    const isAgents = location.hash === '#/agents';
    chat.root.hidden = !!section || isAgents;
    agents.hidden = !isAgents;
    if (chat.root.hidden) chat.leave();
    agentsLink.setAttribute('aria-current', isAgents ? 'page' : 'false');
    if (isAgents) mountAgents(agents, api, id => {
      void chat.refreshAgents().then(() => { if (id) return chat.selectAgent(id); });
    });
    settings.hidden = !section;
    chatLink.setAttribute('aria-current', section || isAgents ? 'false' : 'page');
    for (const l of sectionLinks) l.a.setAttribute('aria-current', l.s === section ? 'page' : 'false');
    if (section) {
      const host = el('div');
      settings.replaceChildren(host); settings.scrollTop = 0;
      if (section.id === 'providers') mountProviders(host, api, chat.agentId(), () => { void chat.refreshAgents(); });
      else section.mount(host, api);
    }
    else if (!isAgents) void chat.refreshAgents();
  }
  window.onhashchange = route;
  route();

  events = new AbortController();
  let failures = 0;
  let wasDown = false;
  void streamEvents((signal) => api.events(signal), {
    onData(data) {
      try {
        const e = JSON.parse(data) as ApiEvent;
        if (e && typeof e.type === 'string') chat.onEvent(e);
      } catch { /* ignore a malformed frame */ }
    },
    onState(connected) {
      conn.textContent = connected ? 'Connected' : 'Reconnecting…';
      conn.classList.toggle('down', !connected);
      if (connected) {
        chat.onStreamOpen();
        banner.hidden = true;
        failures = 0;
        if (wasDown) chat.refresh();
        wasDown = false;
      } else {
        wasDown = true;
        if (++failures >= 3) banner.hidden = false;
      }
    },
  }, events.signal);
}

void boot();
