// Pieces the Settings tabs share: the save bar, a switch, a row, the Allow / Ask / Never control and the ⋯ menu.
import type { Agent } from '../types.ts';
import { btn, el, icon, th } from '../dom.ts';
import { changeText } from './forms.ts';
import type { Change } from './forms.ts';

type Child = Node | string | number | null | undefined | false;

export interface SaveBar {
  root: HTMLElement;
  submit: HTMLButtonElement;
  /** Shows what differs ("Model changed from a to b"), or hides the bar when nothing does. */
  set(changes: Change[], note?: string): void;
  /** Shows the bar with a summary of something being created. */
  show(...words: (Node | string)[]): void;
}

/** `button: true` makes Save a plain button, for a tab that is not one <form>. */
export function saveBar(discard: () => void, o: { action?: string; cancel?: string; button?: boolean } = {}): SaveBar {
  const text = el('span', { class: 'save-bar-text' });
  const submit = el('button', { type: o.button ? 'button' : 'submit', class: 'btn primary' }, o.action ?? 'Save');
  const root = el('div', { class: 'save-bar', role: 'region', 'aria-label': 'Unsaved changes', hidden: true }, text, btn(o.cancel ?? 'Discard', discard, 'quiet'), submit);
  return {
    root, submit,
    set(changes, note) { root.hidden = changes.length === 0; text.replaceChildren(...(changes.length ? changeText(changes, note) : [])); },
    show(...words) { root.hidden = false; text.replaceChildren(...words); },
  };
}

export const sw = (label: string, checked: boolean): HTMLInputElement => el('input', { type: 'checkbox', class: 'switch', role: 'switch', 'aria-label': label, checked });

/** A line of text with an optional quieter line under it, then its controls on the right. */
export function row(text: Child, sub: Child, ...controls: Child[]): HTMLElement {
  return el('div', { class: 'row' }, el('div', { class: 'row-text' }, text, sub ? el('div', { class: 'row-sub' }, sub) : null), ...controls);
}

/** Allow / Ask / Never: `set` presses one segment, or none (a mixed or unknown value). */
export function seg(label: string, options: [value: string, text: string][], onPick: (value: string) => void) {
  const buttons = options.map(([value, text]) => {
    const b = el('button', { type: 'button', 'aria-pressed': 'false' }, text);
    b.addEventListener('click', () => onPick(value));
    return { value, b };
  });
  return {
    root: el('div', { class: 'seg', role: 'group', 'aria-label': label }, ...buttons.map((x) => x.b)),
    set(value?: string) { for (const x of buttons) x.b.setAttribute('aria-pressed', String(x.value === value)); },
  };
}

/** A select of agents; a Thai name is tagged so it gets the Thai font. `all` adds a first "everyone" option with the value ''. */
export function agentSelect(agents: Pick<Agent, 'id' | 'name'>[], value: string, all?: string): HTMLSelectElement {
  const s = el('select', {}, ...(all === undefined ? [] : [el('option', { value: '' }, all)]), ...agents.map((a) => el('option', { value: a.id, lang: th(a.name) }, a.name)));
  s.value = value;
  return s;
}

/** A LINE id shortened to "Uf3a…91c" (the full id goes in a title). */
export const shortId = (id: string): string => (id.length > 12 ? `${id.slice(0, 4)}…${id.slice(-3)}` : id);

// ---- the ⋯ menu on a row: one is open at a time; a press anywhere else on the pane closes it (see menuHost)
let closeOpen = () => {};
let openWrap: HTMLElement | null = null;

/** Call once with the pane that holds the menus, so a press outside the open one closes it. */
export function menuHost(pane: HTMLElement): void {
  closeOpen = () => {}; openWrap = null;
  pane.onpointerdown = (ev) => { if (openWrap && !openWrap.contains(ev.target as Node)) closeOpen(); };
}

export function moreMenu(label: string, items: [text: string, run: () => void, danger?: boolean][]): HTMLElement {
  const more = el('button', { type: 'button', class: 'icon-btn', 'aria-label': label, 'aria-haspopup': 'menu', 'aria-expanded': 'false' }, icon('more'));
  const buttons = items.map(([text, run, danger]) => {
    const b = el('button', { type: 'button', role: 'menuitem', tabindex: -1, class: danger ? 'menu-item danger' : 'menu-item' }, text);
    b.addEventListener('click', () => { close(); run(); });
    return b;
  });
  const menu = el('div', { class: 'menu', role: 'menu', 'aria-label': label, hidden: true }, ...buttons);
  const wrap = el('div', { class: 'row-menu' }, more, menu);
  const close = (refocus = false) => {
    menu.hidden = true; more.setAttribute('aria-expanded', 'false'); if (openWrap === wrap) openWrap = null;
    if (refocus) more.focus();
  };
  const open = () => {
    closeOpen(); closeOpen = close; openWrap = wrap;
    menu.hidden = false; more.setAttribute('aria-expanded', 'true'); buttons[0]?.focus();
  };
  more.addEventListener('click', () => (menu.hidden ? open() : close(true)));
  more.addEventListener('keydown', (ev) => { if (ev.key === 'ArrowDown') { ev.preventDefault(); if (menu.hidden) open(); } });
  menu.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); close(true); return; }
    if (ev.key === 'Tab') { close(); return; }
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const next = buttons.indexOf(document.activeElement as HTMLButtonElement) + (ev.key === 'ArrowDown' ? 1 : -1);
    buttons[(next + buttons.length) % buttons.length]?.focus();
  });
  return wrap;
}
