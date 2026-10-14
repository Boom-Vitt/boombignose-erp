// Minimal, safe text formatting: paragraphs and fenced code. Pure: the DOM side builds text nodes only.

export type Block = { kind: 'p'; text: string } | { kind: 'code'; text: string; lang: string };

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let code: string[] | null = null;
  let lang = '';
  const flush = () => {
    if (para.length) blocks.push({ kind: 'p', text: para.join('\n') });
    para = [];
  };
  for (const line of src.split(/\r\n|\r|\n/)) {
    if (code === null) {
      const open = /^\s*```(.*)$/.exec(line);
      if (open) { flush(); code = []; lang = open[1].trim(); }
      else if (line.trim() === '') flush();
      else para.push(line);
    } else if (/^\s*```\s*$/.test(line)) {
      blocks.push({ kind: 'code', text: code.join('\n'), lang });
      code = null;
    } else code.push(line);
  }
  if (code !== null) blocks.push({ kind: 'code', text: code.join('\n'), lang }); // still streaming
  flush();
  return blocks;
}
