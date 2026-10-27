// BoomBigNose startup screen: what the ERP launcher is doing, or why it stopped, until the ERP answers.
import { appIcon, btn, el, errMsg, toast } from '../dom.ts';

/** Mirrors the Rust `Status` (src-tauri/src/launcher.rs). */
export type OsStatus =
  | { phase: 'starting'; step: 'check' | 'docker' | 'database' | 'erp'; detail: string | null }
  | { phase: 'docker-stopped'; installed: boolean }
  | { phase: 'failed'; title: string; message: string }
  | { phase: 'ready'; url: string };

export type Invoke = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
export interface StartupActions { retry(): void; openDocker(): void }

const STEP_TEXT = {
  check: 'Looking for the ERP folder…',
  docker: 'Checking Docker…',
  database: 'Starting the local database…',
  erp: 'Starting the ERP. The first start builds it and can take a few minutes…',
} as const;

export function startupView(status: OsStatus, actions: StartupActions): HTMLElement {
  switch (status.phase) {
    case 'docker-stopped':
      return el('div', { class: 'splash', role: 'alert' }, appIcon(),
        el('h1', {}, status.installed ? 'Docker is not running' : 'Docker is not installed'),
        el('p', { class: 'muted splash-text' }, status.installed
          ? 'BoomBigNose keeps your ERP data in a local database that runs in Docker. Open Docker, wait until it says it is running, then press Retry.'
          : 'BoomBigNose keeps your ERP data in a local database that runs in Docker. Install Docker Desktop from docker.com, then press Retry.'),
        el('div', { class: 'actions' },
          status.installed ? btn('Open Docker', () => actions.openDocker(), 'primary') : null,
          btn('Retry', () => actions.retry(), status.installed ? '' : 'primary')));
    case 'failed':
      return el('div', { class: 'splash', role: 'alert' }, appIcon(),
        el('h1', {}, status.title),
        el('p', { class: 'error-text splash-text' }, status.message),
        btn('Retry', () => actions.retry(), 'primary'));
    case 'starting':
      return el('div', { class: 'splash', role: 'status' }, appIcon(),
        el('p', {}, STEP_TEXT[status.step]),
        status.detail ? el('p', { class: 'muted mono splash-text' }, status.detail) : null);
    case 'ready':
      return el('div', { class: 'splash', role: 'status' }, appIcon(), el('p', {}, 'Opening the ERP…'));
  }
}

/** Polls the launcher and shows each change; resolves with the ERP's URL once it is ready. */
export async function waitForReady(invoke: Invoke, show: (view: HTMLElement) => void, pollMs = 700): Promise<string> {
  const actions: StartupActions = {
    retry: () => { void invoke('os_retry').catch((e: unknown) => toast(errMsg(e), 'error')); },
    openDocker: () => { void invoke('os_open_docker').catch((e: unknown) => toast(errMsg(e), 'error')); },
  };
  let shown = '';
  for (;;) {
    const status = await invoke<OsStatus>('os_status');
    if (status.phase === 'ready') return status.url;
    const key = JSON.stringify(status);
    if (key !== shown) { shown = key; show(startupView(status, actions)); } // a re-render would drop the focused button
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/**
 * Keeps watching the launcher after Ready. Resolves with its status as soon as it is no longer ready (the ERP server
 * exited), or with null when aborted. The caller restarts the startup screen, which then shows why, with Retry.
 */
export async function waitForStop(invoke: Invoke, signal: AbortSignal, pollMs = 700): Promise<OsStatus | null> {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    if (signal.aborted) return null;
    const status = await invoke<OsStatus>('os_status').catch(() => null); // a hiccup in the bridge is not a stop
    if (signal.aborted) return null;
    if (status && status.phase !== 'ready') return status;
  }
}
