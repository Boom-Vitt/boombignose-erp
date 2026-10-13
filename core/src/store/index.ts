// SQLite store on node:sqlite (WAL): sessions, transcript, model context, memory notes, cron jobs.
// FTS5 trigram tables (external content, kept in sync by triggers) give substring search that works for Thai.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import type { Delivery, Message, Origin } from '../types.ts';

export type MemoryKind = 'user' | 'agent';
export interface SessionInfo { id: string; title: string; origin: Origin; createdAt: number; updatedAt: number }
export interface Session extends SessionInfo { context: Message[] }
export interface MessageHit { sessionId: string; title: string; snippet: string; at: number }
export interface MemoryNote { id: number; kind: MemoryKind; text: string; createdAt: number; updatedAt: number }
export interface MemoryHit extends MemoryNote { snippet: string }
export interface Job {
  id: string; cron: string; prompt: string; delivery: Delivery; enabled: boolean;
  lastRunAt?: number; lastStatus?: string;
}

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
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

  // Trigram FTS needs >= 3 characters; shorter queries use LIKE. The query is always quoted as one phrase, never
  // passed as FTS syntax. Returns the WHERE fragment and its parameter; null for an empty query.
  function matcher(query: string, ftsTable: string, textCol: string): { where: string; param: string; fts: boolean } | null {
    const q = query.trim();
    if (!q) return null;
    if ([...q].length < 3) return { where: `${textCol} LIKE ? ESCAPE '\\'`, param: `%${q.replace(/[\\%_]/g, '\\$&')}%`, fts: false };
    return { where: `${ftsTable} MATCH ?`, param: `"${q.replaceAll('"', '""')}"`, fts: true };
  }

  const session = (r: Row): SessionInfo => ({
    id: r.id, title: r.title, origin: JSON.parse(r.origin), createdAt: r.created_at, updatedAt: r.updated_at,
  });
  const note = (r: Row): MemoryNote => ({ id: r.id, kind: r.kind, text: r.text, createdAt: r.created_at, updatedAt: r.updated_at });
  const touch = (id: string) => run('UPDATE sessions SET updated_at = ? WHERE id = ?', Date.now(), id);

  return {
    // ---- sessions
    createSession(o: { title?: string; origin: Origin }): SessionInfo {
      const id = randomUUID(), now = Date.now();
      run('INSERT INTO sessions (id, title, origin, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, o.title ?? '', originKey(o.origin), now, now);
      return { id, title: o.title ?? '', origin: o.origin, createdAt: now, updatedAt: now };
    },
    listSessions(o: { limit?: number } = {}): SessionInfo[] {
      return all('SELECT * FROM sessions ORDER BY updated_at DESC, rowid DESC LIMIT ?', o.limit ?? 100).map(session);
    },
    getSession(id: string): Session | undefined {
      const r = get('SELECT * FROM sessions WHERE id = ?', id);
      return r && { ...session(r), context: JSON.parse(r.context) as Message[] };
    },
    /** Latest session with exactly this origin (one session per LINE chat). */
    findSessionByOrigin(origin: Origin): SessionInfo | undefined {
      const r = get('SELECT * FROM sessions WHERE origin = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1', originKey(origin));
      return r && session(r);
    },
    deleteSession(id: string): boolean {
      return Number(run('DELETE FROM sessions WHERE id = ?', id).changes) > 0;
    },
    setTitle(id: string, title: string): void {
      run('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?', title, Date.now(), id);
    },
    /** Transcript: append-only; only text blocks are indexed for search. */
    appendMessages(id: string, msgs: Message[]): void {
      const now = Date.now();
      tx(() => {
        for (const m of msgs) {
          run('INSERT INTO messages (session_id, role, content, text, at) VALUES (?, ?, ?, ?, ?)', id, m.role, JSON.stringify(m.content), textOf(m), now);
        }
        touch(id);
      });
    },
    getMessages(id: string): Message[] {
      return all('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id', id).map((r) => ({ role: r.role, content: JSON.parse(r.content) }));
    },
    /** Model context (possibly compacted), separate from the transcript. */
    setContext(id: string, msgs: Message[]): void {
      run('UPDATE sessions SET context = ?, updated_at = ? WHERE id = ?', JSON.stringify(msgs), Date.now(), id);
    },
    /** Best hit per session, best first. */
    searchMessages(query: string, limit = 20): MessageHit[] {
      const q = query.trim(), m = matcher(q, 'messages_fts', 'm.text');
      if (!m) return [];
      // SQLite takes the bare columns from the min/max row: best FTS hit, or newest LIKE hit, per session.
      const sql = `SELECT m.session_id AS sid, s.title, m.text, m.at, ${m.fts ? 'min(rank)' : 'max(m.at)'} AS best
        FROM ${m.fts ? 'messages_fts JOIN messages m ON m.id = messages_fts.rowid' : 'messages m'}
        JOIN sessions s ON s.id = m.session_id WHERE ${m.where} GROUP BY m.session_id
        ORDER BY ${m.fts ? 'best, m.at DESC' : 'best DESC'} LIMIT ?`;
      return all(sql, m.param, limit).map((r) => ({ sessionId: r.sid, title: r.title, snippet: snippetOf(r.text, q), at: r.at }));
    },

    // ---- memory notes
    listMemory(kind?: MemoryKind): MemoryNote[] {
      return all(`SELECT * FROM memory ${kind ? 'WHERE kind = ?' : ''} ORDER BY id`, ...(kind ? [kind] : [])).map(note);
    },
    addMemory(kind: MemoryKind, text: string): MemoryNote {
      const now = Date.now();
      const id = Number(run('INSERT INTO memory (kind, text, created_at, updated_at) VALUES (?, ?, ?, ?)', kind, text, now, now).lastInsertRowid);
      return { id, kind, text, createdAt: now, updatedAt: now };
    },
    updateMemory(id: number, text: string): MemoryNote | undefined {
      run('UPDATE memory SET text = ?, updated_at = ? WHERE id = ?', text, Date.now(), id);
      const r = get('SELECT * FROM memory WHERE id = ?', id);
      return r && note(r);
    },
    deleteMemory(id: number): boolean {
      return Number(run('DELETE FROM memory WHERE id = ?', id).changes) > 0;
    },
    searchMemory(query: string, limit = 20, kind?: MemoryKind): MemoryHit[] {
      const q = query.trim(), m = matcher(q, 'memory_fts', 'm.text');
      if (!m) return [];
      const sql = `SELECT m.* FROM ${m.fts ? 'memory_fts JOIN memory m ON m.id = memory_fts.rowid' : 'memory m'}
        WHERE ${m.where}${kind ? ' AND m.kind = ?' : ''} ORDER BY ${m.fts ? 'rank, ' : ''}m.id DESC LIMIT ?`;
      return all(sql, m.param, ...(kind ? [kind] : []), limit).map((r) => ({ ...note(r), snippet: snippetOf(r.text, q) }));
    },

    // ---- cron jobs (the scheduler owns their meaning)
    listJobs(): Job[] {
      return all('SELECT data FROM jobs ORDER BY rowid').map((r) => JSON.parse(r.data) as Job);
    },
    saveJob(job: Job): void {
      run('INSERT INTO jobs (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', job.id, JSON.stringify(job));
    },
    deleteJob(id: string): boolean {
      return Number(run('DELETE FROM jobs WHERE id = ?', id).changes) > 0;
    },

    close(): void { db.close(); },
  };
}

export type Store = ReturnType<typeof openStore>;
