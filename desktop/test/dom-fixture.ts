// Only the DOM operations these screens use; no browser or timers run in unit tests.
export class TestNode {
  children: TestNode[] = [];
  parent: TestNode | null = null;
  className = '';
  hidden = false;
  disabled = false;
  checked = false;
  value = '';
  style = { height: '' };
  scrollHeight = 0;
  scrollTop = 0;
  clientHeight = 0;
  attrs: Record<string, string> = {};
  handlers = new Map<string, ((event: unknown) => void)[]>();
  private text = '';
  tag: string;
  constructor(tag = '') { this.tag = tag; }
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(''); }
  set textContent(text: string) { this.replaceChildren(); this.text = text; }
  get classList() {
    return {
      add: (name: string) => { this.className += ` ${name}`; },
      toggle: (name: string, on: boolean) => {
        this.className = this.className.split(' ').filter((s) => s !== name).concat(on ? [name] : []).join(' ');
      },
    };
  }
  focus(): void {}
  reset(): void {}
  setAttribute(name: string, value: string): void { this.attrs[name] = value; }
  addEventListener(type: string, fn: (event: unknown) => void): void {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), fn]);
  }
  fire(type: string, event: unknown = { preventDefault() {} }): void {
    for (const fn of this.handlers.get(type) ?? []) fn(event);
  }
  appendChild(node: TestNode): TestNode { node.remove(); this.children.push(node); node.parent = this; return node; }
  append(...nodes: TestNode[]): void { nodes.forEach((node) => this.appendChild(node)); }
  replaceChildren(...nodes: TestNode[]): void {
    this.children.forEach((c) => { c.parent = null; });
    this.children = []; this.text = '';
    this.append(...nodes);
  }
  remove(): void {
    if (this.parent) this.parent.children = this.parent.children.filter((n) => n !== this);
    this.parent = null;
  }
  querySelectorAll(selector: string): TestNode[] {
    const matches = (n: TestNode) => selector.startsWith('.')
      ? n.className.split(' ').includes(selector.slice(1))
      : n.tag === selector;
    return this.children.flatMap((c) => [...(matches(c) ? [c] : []), ...c.querySelectorAll(selector)]);
  }
  querySelector(selector: string): TestNode | null { return this.querySelectorAll(selector)[0] ?? null; }
}

export function installDom(): () => void {
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: {
    createElement: (tag: string) => new TestNode(tag),
    createTextNode: (text: string) => { const node = new TestNode(); node.textContent = text; return node; },
    getElementById: () => null,
  } });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { setTimeout: () => 1, clearTimeout() {} } });
  return () => {
    if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else Reflect.deleteProperty(globalThis, 'document');
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  };
}

export const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
export const flush = () => new Promise<void>((resolve) => setImmediate(resolve));
