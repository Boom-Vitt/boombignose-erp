// Tiny DOM helpers. Everything goes in as text nodes or properties, never as HTML.
import { parseBlocks } from './format.ts';

type Child = Node | string | number | null | undefined | false;
type Props = Record<string, unknown>;
const PROPS = new Set(['value', 'checked', 'disabled', 'hidden', 'selected']);

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...kids: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v as EventListener);
    else if (k === 'class') node.className = String(v);
    else if (PROPS.has(k)) Reflect.set(node, k, v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  add(node, kids);
  return node;
}

export function add(parent: Node, kids: Child[]): void {
  for (const k of kids) {
    if (k === null || k === undefined || k === false) continue;
    parent.appendChild(typeof k === 'object' ? k : document.createTextNode(String(k)));
  }
}

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function toast(message: string, kind: 'info' | 'error' = 'info'): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' }, message);
  host.appendChild(t);
  window.setTimeout(() => t.remove(), kind === 'error' ? 8000 : 3500);
}

/** Runs `fn` with `btn` disabled and shows a failure as a toast. */
export async function guarded(fn: () => Promise<unknown>, btn?: HTMLButtonElement): Promise<boolean> {
  if (btn) btn.disabled = true;
  try { await fn(); return true; }
  catch (e) { toast(errMsg(e), 'error'); return false; }
  finally { if (btn) btn.disabled = false; }
}

export function btn(label: string, onClick: (b: HTMLButtonElement) => void, kind = ''): HTMLButtonElement {
  const b = el('button', { type: 'button', class: `btn ${kind}`.trim() }, label);
  b.addEventListener('click', () => onClick(b));
  return b;
}

/** Destructive button that asks to be clicked twice. */
export function confirmBtn(label: string, onConfirm: (b: HTMLButtonElement) => void, extra = '', again = 'Click again to confirm'): HTMLButtonElement {
  let timer = 0;
  const b = btn(label, () => {
    if (timer) { window.clearTimeout(timer); timer = 0; b.textContent = label; onConfirm(b); return; }
    b.textContent = again;
    timer = window.setTimeout(() => { timer = 0; b.textContent = label; }, 3000);
  }, `danger ${extra}`.trim());
  return b;
}

/** Label wrapping its control, plus an optional hint below. */
export function field(label: string, control: HTMLElement, hint?: string): HTMLElement {
  return el('div', { class: 'field' }, el('label', {}, el('span', { class: 'field-label' }, label), control), hint && el('div', { class: 'hint' }, hint));
}

export function check(label: string, checked: boolean, onChange?: (on: boolean) => void): { root: HTMLLabelElement; input: HTMLInputElement } {
  const input = el('input', { type: 'checkbox', checked });
  if (onChange) input.addEventListener('change', () => onChange(input.checked));
  return { root: el('label', { class: 'check' }, input, el('span', {}, label)), input };
}

export function select(options: [value: string, label: string][], value: string): HTMLSelectElement {
  const s = el('select', {}, ...options.map(([v, l]) => el('option', { value: v, selected: v === value }, l)));
  s.value = value;
  return s;
}

export function badge(text: string, tone = ''): HTMLElement {
  return el('span', { class: `badge ${tone}`.trim() }, text);
}

export function formatTime(t: number | string | null | undefined): string {
  if (t === null || t === undefined || t === '') return '';
  const d = new Date(typeof t === 'number' && t < 1e11 ? t * 1000 : t);
  if (Number.isNaN(d.getTime())) return '';
  const today = new Date();
  return d.toDateString() === today.toDateString()
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString([], { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** Renders model or tool text safely: paragraphs and fenced code from text nodes only. */
export function renderText(into: HTMLElement, text: string): void {
  into.replaceChildren(...parseBlocks(text).map((b) =>
    b.kind === 'p'
      ? el('p', {}, b.text)
      : el('pre', { class: 'code' }, b.lang && el('span', { class: 'code-lang' }, b.lang), el('code', {}, b.text))));
}

/** Loads data into a pane with a loading state and a retry on failure. */
export async function load<T>(pane: HTMLElement, fetcher: () => Promise<T>, render: (data: T) => void): Promise<void> {
  pane.replaceChildren(el('p', { class: 'muted' }, 'Loading…'));
  try {
    const data = await fetcher();
    pane.replaceChildren();
    render(data);
  } catch (e) {
    pane.replaceChildren(el('div', { class: 'notice error', role: 'alert' }, el('p', {}, errMsg(e)), btn('Retry', () => void load(pane, fetcher, render))));
  }
}
