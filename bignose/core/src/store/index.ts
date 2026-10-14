// SQLite store on node:sqlite (WAL): sessions, transcript, model context, memory notes, cron jobs.
// FTS5 trigram tables (external content, kept in sync by triggers) give substring search that works for Thai.
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomUUID } from 'node:crypto';
import type { Agent, Delivery, Message, Origin } from '../types.ts';

export type MemoryKind = 'user' | 'agent';
export interface SessionInfo { id: string; agentId: string; title: string; origin: Origin; createdAt: number; updatedAt: number }
export interface Session extends SessionInfo { context: Message[] }
export type NoticeLevel = 'info' | 'warn' | 'error';
/** A run outcome note (error, stopped, turn limit, cut reply, empty reply); `after` = how many messages came before it. */
export interface Notice { after: number; level: NoticeLevel; text: string; at: number }
export interface MessageHit { sessionId: string; title: string; snippet: string; at: number }
export interface MemoryNote { id: number; agentId: string | null; kind: MemoryKind; text: string; createdAt: number; updatedAt: number }
export interface MemoryHit extends MemoryNote { snippet: string }
export interface Job {
  id: string; agentId: string; cron: string; prompt: string; delivery: Delivery; enabled: boolean;
  lastRunAt?: number; lastStatus?: string;
}
export type AgentInput = Pick<Agent, 'name' | 'provider' | 'model'> & Partial<Pick<Agent, 'icon' | 'instructions' | 'permissions' | 'connectors' | 'skills'>> & { maxTokens?: number | null };

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, icon TEXT NOT NULL, instructions TEXT NOT NULL,
  provider TEXT NOT NULL, model TEXT NOT NULL, permissions TEXT NOT NULL, connectors TEXT NOT NULL, skills TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '', origin TEXT NOT NULL, context TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS sessions_origin ON sessions(origin, updated_at);
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL, content TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS messages_session ON messages(session_id, id);
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, content='messages', content_rowid='id', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TRIGGER IF NOT EXISTS messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
CREATE TRIGGER IF NOT EXISTS messages_au AFTER UPDATE OF text ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TABLE IF NOT EXISTS notices (
  id INTEGER PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  after_messages INTEGER NOT NULL, level TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS notices_session ON notices(session_id, id);
CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY, kind TEXT NOT NULL CHECK (kind IN ('user', 'agent')), text TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(text, content='memory', content_rowid='id', tokenize='trigram');
CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
  INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.id, old.text); END;
CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE OF text ON memory BEGIN
  INSERT INTO memory_fts(memory_fts, rowid, text) VALUES ('delete', old.id, old.text);
  INSERT INTO memory_fts(rowid, text) VALUES (new.id, new.text); END;
CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

type Row = Record<string, any>;

// Exact-origin key: same fields in any order give the same string.
const originKey = (o: Origin) => JSON.stringify(o, Object.keys(o).sort());

const textOf = (m: Message) => m.content.flatMap((b) => (b.type === 'text' ? [b.text] : [])).join('\n');

// ~120 chars of context around the first match; the match itself is not marked (clients may highlight).
function snippetOf(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ');
  const i = flat.toLowerCase().indexOf(query.toLowerCase());
  const start = i > 40 ? i - 40 : 0;
  return (start > 0 ? '…' : '') + flat.slice(start, start + 120) + (start + 120 < flat.length ? '…' : '');
}

export function openStore(file: string) {
  const db = new DatabaseSync(file);
  db.exec(SCHEMA);
  const all = (sql: string, ...p: any[]) => db.prepare(sql).all(...p) as Row[];
  const get = (sql: string, ...p: any[]) => db.prepare(sql).get(...p) as Row | undefined;
  const run = (sql: string, ...p: any[]) => db.prepare(sql).run(...p);
  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const r = fn(); db.exec('COMMIT'); return r; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };
  // Older installations keep every row and FTS trigger; only missing ownership columns are added.
  tx(() => {
    if (!all('PRAGMA table_info(agents)').some(r => r.name === 'max_tokens')) db.exec('ALTER TABLE agents ADD COLUMN max_tokens INTEGER');
    for (const table of ['sessions', 'memory', 'jobs']) {
      if (!all(`PRAGMA table_info(${table})`).some(r => r.name === 'agentId')) db.exec(`ALTER TABLE ${table} ADD COLUMN agentId TEXT`);
      db.exec(`CREATE INDEX IF NOT EXISTS ${table}_agent ON ${table}(agentId)`);
    }
  });
  const agent = (r: Row): Agent => ({ id: r.id, name: r.name, icon: r.icon, instructions: r.instructions,
    provider: r.provider, model: r.model, ...(r.max_tokens !== null ? { maxTokens: r.max_tokens } : {}), permissions: JSON.parse(r.permissions), connectors: JSON.parse(r.connectors),
    skills: JSON.parse(r.skills), createdAt: r.created_at, updatedAt: r.updated_at });
  const requireAgent = (id: string) => { if (!get('SELECT id FROM agents WHERE id = ?', id)) throw new Error(`unknown agent: ${id}`); };

  // Trigram FTS needs >= 3 characters; shorter queries use LIKE. The query is always quoted as one phrase, never
  // passed as FTS syntax. Returns the WHERE fragment and its parameter; null for an empty query.
  function matcher(query: string, ftsTable: string, textCol: string): { where: string; param: string; fts: boolean } | null {
    const q = query.trim();
    if (!q) return null;
    if ([...q].length < 3) return { where: `${textCol} LIKE ? ESCAPE '\\'`, param: `%${q.replace(/[\\%_]/g, '\\$&')}%`, fts: false };
    return { where: `${ftsTable} MATCH ?`, param: `"${q.replaceAll('"', '""')}"`, fts: true };
  }

  const session = (r: Row): SessionInfo => ({
    id: r.id, agentId: r.agentId, title: r.title, origin: JSON.parse(r.origin), createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const note = (r: Row): MemoryNote => ({ id: r.id, agentId: r.agentId, kind: r.kind, text: r.text, createdAt: r.created_at, updatedAt: r.updated_at });
  const touch = (id: string) => run('UPDATE sessions SET updated_at = ? WHERE id = ?', Date.now(), id);

  return {
    // ---- agents
    listAgents(): Agent[] { return all('SELECT * FROM agents ORDER BY created_at, id').map(agent); },
    getAgent(id: string): Agent | undefined { const r = get('SELECT * FROM agents WHERE id = ?', id); return r && agent(r); },
    createAgent(input: AgentInput): Agent {
      const now = Date.now();
      const a: Agent = { id: 'ag_' + randomBytes(6).toString('hex'), name: input.name.trim(), icon: input.icon ?? '🤖',
        instructions: input.instructions ?? '', provider: input.provider, model: input.model, ...(input.maxTokens != null ? { maxTokens: input.maxTokens } : {}), permissions: input.permissions ?? {},
        connectors: input.connectors ?? null, skills: input.skills ?? null, createdAt: now, updatedAt: now };
      run('INSERT INTO agents (id, name, icon, instructions, provider, model, permissions, connectors, skills, created_at, updated_at, max_tokens) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', a.id, a.name, a.icon, a.instructions, a.provider, a.model,
        JSON.stringify(a.permissions), JSON.stringify(a.connectors), JSON.stringify(a.skills), now, now, a.maxTokens ?? null);
      return a;
    },
    updateAgent(id: string, patch: Partial<AgentInput>): Agent | undefined {
      const old = this.getAgent(id); if (!old) return undefined;
      const a: Agent = { ...old, ...patch, maxTokens: patch.maxTokens === null ? undefined : patch.maxTokens ?? old.maxTokens, name: (patch.name ?? old.name).trim(), updatedAt: Date.now() };
      if (a.maxTokens === undefined) delete a.maxTokens;
      run('UPDATE agents SET name=?, icon=?, instructions=?, provider=?, model=?, permissions=?, connectors=?, skills=?, updated_at=?, max_tokens=? WHERE id=?',
        a.name, a.icon, a.instructions, a.provider, a.model, JSON.stringify(a.permissions), JSON.stringify(a.connectors), JSON.stringify(a.skills), a.updatedAt, a.maxTokens ?? null, id);
      return a;
    },
    deleteAgent(id: string): boolean {
      return tx(() => {
        if (!this.getAgent(id)) return false;
        if (this.listAgents().length === 1) throw new Error('cannot delete the last agent');
        run('DELETE FROM sessions WHERE agentId = ?', id);
        run("DELETE FROM memory WHERE kind = 'agent' AND agentId = ?", id);
        run('DELETE FROM jobs WHERE agentId = ?', id);
        run('DELETE FROM agents WHERE id = ?', id);
        return true;
      });
    },
    ensureDefaultAgent(defaults: { provider: string; model: string; instructions?: string }): Agent {
      return tx(() => {
        const first = this.listAgents()[0] ?? this.createAgent({ name: 'BigNose', ...defaults });
        for (const table of ['sessions', 'memory', 'jobs'])
          run(`UPDATE ${table} SET agentId = ? WHERE ${table === 'memory' ? "kind = 'agent' AND " : ''}(agentId IS NULL OR agentId NOT IN (SELECT id FROM agents))`, first.id);
        run("UPDATE memory SET agentId = NULL WHERE kind = 'user'");
        return first;
      });
    },
    // ---- sessions
    createSession(o: { title?: string; origin: Origin; agentId: string }): SessionInfo {
      requireAgent(o.agentId);
      const id = randomUUID(), now = Date.now();
      run('INSERT INTO sessions (id, title, origin, created_at, updated_at, agentId) VALUES (?, ?, ?, ?, ?, ?)', id, o.title ?? '', originKey(o.origin), now, now, o.agentId);
      return { id, agentId: o.agentId, title: o.title ?? '', origin: o.origin, createdAt: now, updatedAt: now };
    },
    listSessions(o: { limit?: number; agentId?: string } = {}): SessionInfo[] {
      return all(`SELECT * FROM sessions ${o.agentId ? 'WHERE agentId = ?' : ''} ORDER BY updated_at DESC, rowid DESC LIMIT ?`, ...(o.agentId ? [o.agentId] : []), o.limit ?? 100).map(session);
    },
    getSession(id: string): Session | undefined {
      const r = get('SELECT * FROM sessions WHERE id = ?', id);
      return r && { ...session(r), context: JSON.parse(r.context) as Message[] };
    },
    /** Latest session with exactly this origin and agent (one session per LINE chat per agent). */
    findSessionByOrigin(origin: Origin, agentId: string): SessionInfo | undefined {
      const r = get('SELECT * FROM sessions WHERE origin = ? AND agentId = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1', originKey(origin), agentId);
      return r && session(r);
    },
    deleteSession(id: string): boolean {
      return Number(run('DELETE FROM sessions WHERE id = ?', id).changes) > 0;
    },
    setTitle(id: string, title: string): void {
      run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', title, Date.now(), id);
    },
    /** Transcript: append-only; only text blocks are indexed for search. Returns the new row ids, in order. */
    appendMessages(id: string, msgs: Message[]): number[] {
      const now = Date.now();
      return tx(() => {
        const ids = msgs.map((m) => Number(run('INSERT INTO messages (session_id, role, content, text, at) VALUES (?, ?, ?, ?, ?)', id, m.role, JSON.stringify(m.content), textOf(m), now).lastInsertRowid));
        touch(id);
        return ids;
      });
    },
    /** Rewrites rows from `appendMessages` whose content changed (a secret learned after they were saved); rows stay in place. */
    updateMessages(ids: number[], msgs: Message[]): void {
      tx(() => ids.forEach((rowId, i) => {
        const m = msgs[i], content = m && JSON.stringify(m.content);
        if (m) run('UPDATE messages SET content = ?, text = ? WHERE id = ? AND content != ?', content, textOf(m), rowId, content);
      }));
    },
    /** Run outcome note, placed after the messages saved so far. */
    addNotice(id: string, level: NoticeLevel, text: string): void {
      run('INSERT INTO notices (session_id, after_messages, level, text, at) VALUES (?, (SELECT count(*) FROM messages WHERE session_id = ?), ?, ?, ?)', id, id, level, text, Date.now());
    },
    getNotices(id: string): Notice[] {
      return all('SELECT after_messages, level, text, at FROM notices WHERE session_id = ? ORDER BY id', id).map((r) => ({ after: r.after_messages, level: r.level, text: r.text, at: r.at }));
    },
    getMessages(id: string): Message[] {
      return all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id', id).map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
    },
    /** Model context (possibly compacted), separate from the transcript. */
    setContext(id: string, msgs: Message[]): void {
      run('UPDATE sessions SET context = ?, updated_at = ? WHERE id = ?', JSON.stringify(msgs), Date.now(), id);
    },
    /** Best hit per session, best first. */
    searchMessages(query: string, limit = 20, agentId?: string): MessageHit[] {
      const q = query.trim(), m = matcher(q, 'messages_fts', 'm.text');
      if (!m) return [];
      // SQLite takes the bare columns from the min/max row: best FTS hit, or newest LIKE hit, per session.
      const sql = `SELECT m.session_id AS sid, s.title, m.text, m.at, ${m.fts ? 'min(rank)' : 'max(m.at)'} AS best
        FROM ${m.fts ? 'messages_fts JOIN messages m ON m.id = messages_fts.rowid' : 'messages m'}
        JOIN sessions s ON s.id = m.session_id WHERE ${m.where}${agentId ? ' AND s.agentId = ?' : ''} GROUP BY m.session_id
        ORDER BY ${m.fts ? 'best, m.at DESC' : 'best DESC'} LIMIT ?`;
      return all(sql, m.param, ...(agentId ? [agentId] : []), limit).map((r) => ({ sessionId: r.sid, title: r.title, snippet: snippetOf(r.text, q), at: r.at }));
    },

    // ---- memory notes
    listMemory(kind?: MemoryKind, agentId?: string): MemoryNote[] {
      return all(`SELECT * FROM memory WHERE 1=1${kind ? ' AND kind = ?' : ''}${agentId ? " AND (kind = 'user' OR agentId = ?)" : ''} ORDER BY id`, ...(kind ? [kind] : []), ...(agentId ? [agentId] : [])).map(note);
    },
    addMemory(kind: MemoryKind, text: string, agentId?: string): MemoryNote {
      if (kind === 'agent') { if (!agentId) throw new Error('agent memory needs an agentId'); requireAgent(agentId); }
      const owner = kind === 'agent' ? agentId! : null;
      const now = Date.now();
      const id = Number(run('INSERT INTO memory (kind, text, created_at, updated_at, agentId) VALUES (?, ?, ?, ?, ?)', kind, text, now, now, owner).lastInsertRowid);
      return { id, agentId: owner, kind, text, createdAt: now, updatedAt: now };
    },
    updateMemory(id: number, text: string): MemoryNote | undefined {
      run('UPDATE memory SET text = ?, updated_at = ? WHERE id = ?', text, Date.now(), id);
      const r = get('SELECT * FROM memory WHERE id = ?', id);
      return r && note(r);
    },
    deleteMemory(id: number): boolean {
      return Number(run('DELETE FROM memory WHERE id = ?', id).changes) > 0;
    },
    searchMemory(query: string, limit = 20, kind?: MemoryKind, agentId?: string): MemoryHit[] {
      const q = query.trim(), m = matcher(q, 'memory_fts', 'm.text');
      if (!m) return [];
      const sql = `SELECT m.* FROM ${m.fts ? 'memory_fts JOIN memory m ON m.id = memory_fts.rowid' : 'memory m'}
        WHERE ${m.where}${kind ? ' AND m.kind = ?' : ''}${agentId ? " AND (m.kind = 'user' OR m.agentId = ?)" : ''} ORDER BY ${m.fts ? 'rank, ' : ''}m.id DESC LIMIT ?`;
      return all(sql, m.param, ...(kind ? [kind] : []), ...(agentId ? [agentId] : []), limit).map((r) => ({ ...note(r), snippet: snippetOf(r.text, q) }));
    },

    // ---- cron jobs (the scheduler owns their meaning)
    listJobs(agentId?: string): Job[] {
      return all(`SELECT data, agentId FROM jobs ${agentId ? 'WHERE agentId = ?' : ''} ORDER BY rowid`, ...(agentId ? [agentId] : [])).map((r) => ({ ...JSON.parse(r.data), agentId: r.agentId } as Job));
    },
    saveJob(job: Job): void {
      requireAgent(job.agentId);
      run('INSERT INTO jobs (id, data, agentId) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, agentId = excluded.agentId', job.id, JSON.stringify(job), job.agentId);
    },
    deleteJob(id: string): boolean {
      return Number(run('DELETE FROM jobs WHERE id = ?', id).changes) > 0;
    },

    close(): void { db.close(); },
  };
}

export type Store = ReturnType<typeof openStore>;
