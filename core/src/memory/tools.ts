// memory_read / memory_write / session_search tools and the memory block for the system prompt.
import type { Tool, ToolResult } from '../types.ts';
import type { MemoryKind, MemoryNote, Store } from '../store/index.ts';

const PROMPT_CAP = 4000;
const NOTE_CAP = 2000;
const KINDS = ['user', 'agent'];

const fail = (content: string): ToolResult => ({ content, isError: true });
const kindOf = (v: unknown): MemoryKind | undefined => (KINDS.includes(v as string) ? (v as MemoryKind) : undefined);
const oneLine = (s: string) => s.replace(/\s*\n\s*/g, ' ').slice(0, NOTE_CAP);
const limitOf = (v: unknown, dflt: number) => (Number.isInteger(v) && (v as number) > 0 ? Math.min(v as number, 100) : dflt);

export function memoryTools(store: Store, agentId: string): Tool[] {
  const read: Tool = {
    name: 'memory_read',
    description: 'Read persistent memory notes. Without "query" lists notes (newest last); with "query" searches them. '
      + 'Kinds: "user" = facts about the user, "agent" = your own notes.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: KINDS, description: 'Only notes of this kind' },
        query: { type: 'string', description: 'Text to search for' },
        limit: { type: 'integer', description: 'Max notes (default 50)' },
      },
    },
    defaultPolicy: 'allow',
    async run(input) {
      const kind = kindOf(input.kind), limit = limitOf(input.limit, 50);
      if (input.kind !== undefined && !kind) return fail('kind must be "user" or "agent"');
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      const notes: MemoryNote[] = query ? store.searchMemory(query, limit, kind, agentId) : store.listMemory(kind, agentId).slice(-limit);
      if (!notes.length) return { content: query ? 'No matching notes.' : 'No notes.' };
      return { content: notes.map((n) => `[${n.id}] (${n.kind}) ${n.text}`).join('\n') };
    },
  };

  const write: Tool = {
    name: 'memory_write',
    description: 'Add, update or delete a persistent memory note. "add" needs kind and text; "update" needs id and text; '
      + '"delete" needs id. Keep notes short and durable (preferences, facts, lessons), not chat history.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['add', 'update', 'delete'] },
        kind: { type: 'string', enum: KINDS, description: 'For add' },
        id: { type: 'integer', description: 'For update and delete' },
        text: { type: 'string', description: 'For add and update' },
      },
      required: ['action'],
    },
    defaultPolicy: 'allow',
    async run(input) {
      const { action, id } = input;
      const text = typeof input.text === 'string' ? input.text.trim() : '';
      if (action === 'add' || action === 'update') {
        if (!text) return fail('text is required');
        if (text.length > NOTE_CAP) return fail(`text is too long (max ${NOTE_CAP} characters)`);
      }
      if (action === 'add') {
        const kind = kindOf(input.kind);
        if (!kind) return fail('kind must be "user" or "agent"');
        return { content: `Added note ${store.addMemory(kind, text, agentId).id}.` };
      }
      if (action === 'update' || action === 'delete') {
        if (!Number.isInteger(id)) return fail('id is required');
        if (!store.listMemory(undefined, agentId).some(n => n.id === id)) return fail(`No note with id ${id}.`);
        const ok = action === 'update' ? !!store.updateMemory(id as number, text) : store.deleteMemory(id as number);
        return ok ? { content: `${action === 'update' ? 'Updated' : 'Deleted'} note ${id}.` } : fail(`No note with id ${id}.`);
      }
      return fail('action must be "add", "update" or "delete"');
    },
  };

  return [read, write];
}

export function sessionSearchTool(store: Store, agentId: string): Tool {
  return {
    name: 'session_search',
    description: 'Full-text search across past conversations (any language, substring match). Returns the best hit per session.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to look for' },
        limit: { type: 'integer', description: 'Max sessions (default 10)' },
      },
      required: ['query'],
    },
    defaultPolicy: 'allow',
    async run(input) {
      const query = typeof input.query === 'string' ? input.query.trim() : '';
      if (!query) return fail('query is required');
      const hits = store.searchMessages(query, limitOf(input.limit, 10), agentId);
      if (!hits.length) return { content: 'No matching conversations.' };
      return {
        content: hits.map((h) => `${new Date(h.at).toISOString().slice(0, 16).replace('T', ' ')} session ${h.sessionId} "${h.title}": ${h.snippet}`).join('\n'),
      };
    },
  };
}

/** Notes for the system prompt, newest kept first when over the cap, shown oldest first. '' when there are none. */
export function memoryPrompt(store: Store, agentId?: string): string {
  const kept: MemoryNote[] = [];
  let size = 0;
  const all = store.listMemory(undefined, agentId);
  for (const n of [...all].reverse()) {
    size += oneLine(n.text).length + 4;
    if (size > PROMPT_CAP - 200) break; // headroom for the headings and the omitted-notes line
    kept.unshift(n);
  }
  if (!kept.length) return '';
  const section = (title: string, kind: MemoryKind) => {
    const lines = kept.filter((n) => n.kind === kind).map((n) => `- ${oneLine(n.text)}`);
    return lines.length ? `${title}\n${lines.join('\n')}` : '';
  };
  const parts = [section('About the user:', 'user'), section('Your own notes:', 'agent')].filter(Boolean);
  if (kept.length < all.length) parts.push(`(${all.length - kept.length} older notes omitted; use memory_read)`);
  return `# Memory\n${parts.join('\n\n')}`.slice(0, PROMPT_CAP);
}
