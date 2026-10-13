// App shell: asks the Rust side for the daemon, then wires Chat, Settings and the event stream.
import { createApi } from './api.ts';
import type { Api } from './api.ts';
import { createChat } from './chat.ts';
import { btn, el, errMsg } from './dom.ts';
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
  interface Window { __TAURI__?: { core: { invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> } } }
}

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
  try {
    const invoke = window.__TAURI__?.core.invoke;
    if (!invoke) throw new Error('This page only works inside the BigNose app.');
    const info = await invoke<DaemonInfo>('daemon_info');
    api = createApi({ port: info.port, token: info.token });
    await api.health(); // proves the token and the webview's access to the daemon
  } catch (e) {
    app.replaceChildren(failure(errMsg(e)));
    return;
  }
  shell(api);
}

function shell(api: Api): void {
  const chat = createChat(api);
  const settings = el('section', { class: 'settings', 'aria-label': 'Settings' });
  const model = el('div', { class: 'nav-model' });
  const conn = el('div', { class: 'nav-conn' });
  const banner = el('div', { class: 'banner', role: 'alert', hidden: true },
    el('span', {}, 'Lost the connection to the BigNose daemon.'), btn('Retry', () => void boot(), 'small'));

  const link = (href: string, text: string) => el('a', { href, class: 'nav-link' }, text);
  const chatLink = link('#/chat', 'Chat');
  const sectionLinks = SECTIONS.map((s) => ({ s, a: link(`#/settings/${s.id}`, s.label) }));
  const nav = el('nav', { class: 'nav', 'aria-label': 'Main' },
    el('div', { class: 'brand' }, logo(), el('span', {}, 'BigNose')),
    chatLink, el('div', { class: 'nav-group' }, 'Settings'), ...sectionLinks.map((l) => l.a),
    el('div', { class: 'nav-foot' }, model, conn));

  app.replaceChildren(el('div', { class: 'shell' }, nav, el('main', { class: 'main' }, banner, chat.root, settings)));

  async function showStatus(): Promise<void> {
    try {
      const st = await api.status();
      model.textContent = `${st.provider.id} · ${st.provider.model}`;
    } catch { model.textContent = ''; }
  }

  function route(): void {
    const id = /^#\/settings\/(\w+)/.exec(location.hash)?.[1];
    const section = SECTIONS.find((s) => s.id === id);
    chat.root.hidden = !!section;
    settings.hidden = !section;
    chatLink.setAttribute('aria-current', section ? 'false' : 'page');
    for (const l of sectionLinks) l.a.setAttribute('aria-current', l.s === section ? 'page' : 'false');
    if (section) { settings.replaceChildren(); settings.scrollTop = 0; section.mount(settings, api); }
    else void showStatus();
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
