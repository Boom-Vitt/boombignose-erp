// Minimal, safe text formatting: paragraphs, headings, lists, bold, inline code and fenced code. Pure: the DOM side builds text nodes only.

export type Block =
  | { kind: 'p'; text: string }
  | { kind: 'code'; text: string; lang: string }
  | { kind: 'h'; level: 2 | 3; text: string }
  | { kind: 'ul' | 'ol'; items: string[] };
export type Inline = { kind: 'text' | 'strong' | 'code'; text: string };

const HEADING = /^(#{1,6})\s+(\S.*?)\s*$/;
const BULLET = /^ {0,3}[-*+]\s+(\S.*)$/;
const NUMBERED = /^ {0,3}\d{1,3}[.)]\s+(\S.*)$/;

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list = null as { kind: 'ul' | 'ol'; items: string[] } | null; // changed inside the helpers below, so no narrowing to null
  let code: string[] | null = null;
  let lang = '';
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') });
    if (list) blocks.push(list);
    para = []; list = null;
  };
  const item = (kind: 'ul' | 'ol', text: string) => {
    if (list?.kind !== kind) { flush(); list = { kind, items: [] }; }
    list.items.push(text);
  };
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (code !== null) {
      if (/^\s*```\s*$/.test(line)) { blocks.push({ kind: 'code', text: code.join('\n'), lang }); code = null; }
      else code.push(line);
      continue;
    }
    const open = /^\s*```(.*)$/.exec(line);
    const heading = HEADING.exec(line);
    const bullet = BULLET.exec(line);
    const numbered = NUMBERED.exec(line);
    if (open) { flush(); code = []; lang = open[1]!.trim(); }
    else if (line.trim() === '') flush();
    else if (heading) { flush(); blocks.push({ kind: 'h', level: heading[1]!.length <= 2 ? 2 : 3, text: heading[2]! }); }
    else if (bullet) item('ul', bullet[1]!);
    else if (numbered) item('ol', numbered[1]!);
    else if (list && /^ {2,}\S/.test(line)) list.items[list.items.length - 1] += `\n${line.trim()}`; // a wrapped list item
    else { if (list) flush(); para.push(line); }
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n'), lang }); // still streaming
  flush();
  return blocks;
}

/** **bold** and `code` inside one block's text; anything unclosed (mid-stream) stays literal. */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g)) {
    if (m.index > last) out.push({ kind: 'text', text: text.slice(last, m.index) });
    out.push(m[1] !== undefined ? { kind: 'strong', text: m[1] } : { kind: 'code', text: m[2]! });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  return out;
}
