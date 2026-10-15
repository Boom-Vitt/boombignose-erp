// Cron: 5-field parser, next-run in local time, a persistent Scheduler and the schedule_* tools.
import { randomBytes } from 'node:crypto';
import type { Delivery, Tool, ToolResult } from '../types.ts';
import type { Job, Store } from '../store/index.ts';

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

export interface CronSpec {
  minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; // month 1-12, dow 0-6 (Sunday 0)
  domRestricted: boolean; dowRestricted: boolean;
}

// One field: comma list of `*`, `n`, `a-b`, each with optional `/step`. `n/step` means n through the end.
function parseField(text: string, label: string, min: number, max: number, names: string[] = [], nameBase = 0, starMax = max): Set<number> {
  const value = (tok: string): number => {
    const i = names.indexOf(tok.toUpperCase());
    const v = /^\d+$/.test(tok) ? Number(tok) : i >= 0 ? i + nameBase : NaN;
    if (Number.isNaN(v)) throw new Error(`${label}: unknown value "${tok}"`);
    if (v < min || v > max) throw new Error(`${label}: ${v} is out of range ${min}-${max}`);
    return v;
  };
  const out = new Set<number>();
  for (const part of text.split(',')) {
    const [range = '', stepText, ...extra] = part.split('/');
    if (extra.length) throw new Error(`${label}: bad step in "${part}"`);
    if (stepText !== undefined && !/^\d+$/.test(stepText)) throw new Error(`${label}: bad step "${stepText}"`);
    const step = stepText === undefined ? 1 : Number(stepText);
    if (step < 1) throw new Error(`${label}: step must be at least 1`);
    let from: number, to: number;
    if (range === '*') [from, to] = [min, starMax];
    else if (range.includes('-')) {
      const [a = '', b = '', ...more] = range.split('-');
      if (more.length) throw new Error(`${label}: bad range "${range}"`);
      [from, to] = [value(a), value(b)];
      if (from > to) throw new Error(`${label}: range "${range}" runs backwards`);
    } else {
      from = value(range);
      to = stepText === undefined ? from : max;
    }
    for (let v = from; v <= to; v += step) out.add(v);
  }
  return out;
}

/** `minute hour day-of-month month day-of-week`. Throws an Error naming the problem. */
export function parseCron(expr: string): CronSpec {
  const f = expr.trim().split(/\s+/);
  try {
    if (f.length !== 5) throw new Error(`expected 5 fields (minute hour day-of-month month day-of-week), got ${expr.trim() ? f.length : 0}`);
    const dow = parseField(f[4]!, 'day-of-week', 0, 7, DAYS, 0, 6);
    if (dow.delete(7)) dow.add(0); // 7 is Sunday too
    const dom = parseField(f[2]!, 'day-of-month', 1, 31);
    return {
      minute: parseField(f[0]!, 'minute', 0, 59),
      hour: parseField(f[1]!, 'hour', 0, 23),
      dom,
      month: parseField(f[3]!, 'month', 1, 12, MONTHS, 1),
      dow,
      // A field that matches everything is not a restriction (so "1-31" behaves like "*").
      domRestricted: dom.size < 31,
      dowRestricted: dow.size < 7,
    };
  } catch (e) {
    throw new Error(`invalid cron "${expr}": ${(e as Error).message}`);
  }
}

// Both day fields restricted: either may match (Vixie cron). Otherwise both must match, and an unrestricted one always does.
function dayMatches(c: CronSpec, d: Date): boolean {
  const byDate = c.dom.has(d.getDate()), byWeekday = c.dow.has(d.getDay());
  return c.domRestricted && c.dowRestricted ? byDate || byWeekday : byDate && byWeekday;
}

/** First matching minute strictly after `after`, in local time. Throws when the expression can never match (e.g. Feb 31). */
export function nextRun(expr: string, after: Date): Date {
  const c = parseCron(expr);
  const afterWall = Date.UTC(after.getFullYear(), after.getMonth(), after.getDate(), after.getHours(), after.getMinutes());
  const limitYear = after.getFullYear() + 9; // Feb 29 can be 8 years away (2096 to 2104)
  let d = new Date((Math.floor(after.getTime() / 60_000) + 1) * 60_000);
  while (d.getFullYear() <= limitYear) {
    const [y, mo, day, h] = [d.getFullYear(), d.getMonth(), d.getDate(), d.getHours()];
    if (!c.month.has(mo + 1)) d = new Date(y, mo + 1, 1);
    else if (!dayMatches(c, d)) d = new Date(y, mo, day + 1);
    else if (!c.hour.has(h)) d = new Date(y, mo, day, h + 1);
    else if (!c.minute.has(d.getMinutes())) d = new Date(d.getTime() + 60_000);
    // Fall-back repeats wall-clock minutes that have already passed.
    else if (d.getTimezoneOffset() > after.getTimezoneOffset() && Date.UTC(y, mo, day, h, d.getMinutes()) <= afterWall)
      d = new Date(d.getTime() + 60_000);
    else return d;
  }
  throw new Error(`cron "${expr}" never runs`);
}

// ---- scheduler

export interface SchedulerOptions {
  store: Pick<Store, 'listJobs' | 'saveJob' | 'deleteJob'>;
  onFire: (job: Job) => Promise<void>;
  now?: () => Date;
  setTimer?: (fn: () => void, ms: number) => () => void; // returns a cancel function
}
export type ScheduledJob = Job & { nextRunAt?: number };

const defaultSetTimer = (fn: () => void, ms: number) => {
  const t = setTimeout(fn, ms);
  t.unref();
  return () => clearTimeout(t);
};

export class Scheduler {
  #opts: SchedulerOptions;
  #next = new Map<string, number>();   // enabled job id -> next run (ms); only while started
  #sig = new Map<string, string>();    // job id -> the enabled flag and cron it was planned from; a different stored value is re-planned
  #synced = 0;                         // ms of the last #sync
  #running = new Set<string>();
  #cancel: (() => void) | undefined;
  #started = false;

  constructor(opts: SchedulerOptions) { this.#opts = opts; }

  #now = () => (this.#opts.now ?? (() => new Date()))();
  #find = (id: string) => this.#opts.store.listJobs().find((j) => j.id === id);

  /** Loads the persisted jobs. Runs that came due while stopped are skipped: the next run is computed from now. */
  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#sync(this.#now());
    this.#arm();
  }

  stop(): void {
    this.#started = false;
    this.#cancel?.();
    this.#cancel = undefined;
    this.#next.clear();
    this.#sig.clear();
  }

  add(input: { cron: string; prompt: string; delivery: Delivery; agentId: string }): Job {
    const cron = input.cron.trim().split(/\s+/).join(' ');
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error('prompt is required');
    nextRun(cron, this.#now()); // throws on a bad or never-matching expression
    const job: Job = { id: randomBytes(4).toString('hex'), agentId: input.agentId, cron, prompt, delivery: input.delivery, enabled: true };
    this.#opts.store.saveJob(job);
    this.#resync();
    return job;
  }

  remove(id: string): boolean {
    const ok = this.#opts.store.deleteJob(id);
    this.#resync();
    return ok;
  }

  setEnabled(id: string, on: boolean): boolean {
    const job = this.#find(id);
    if (!job) return false;
    this.#opts.store.saveJob({ ...job, enabled: on });
    this.#resync();
    return true;
  }

  list(): ScheduledJob[] {
    const now = this.#now();
    return this.#opts.store.listJobs().map((job) => {
      try { return job.enabled ? { ...job, nextRunAt: nextRun(job.cron, now).getTime() } : job; } catch { return job; }
    });
  }

  #plan(job: Job, from: Date): void {
    try { this.#next.set(job.id, nextRun(job.cron, from).getTime()); } catch { this.#next.delete(job.id); }
  }

  /** Plans what is new or changed in the store and forgets what is gone. Another process (`bignose chat -q`) writes the same store. */
  #sync(now: Date, from = now): void {
    const jobs = this.#opts.store.listJobs(), ids = new Set(jobs.map((j) => j.id));
    for (const id of [...this.#sig.keys()]) if (!ids.has(id)) { this.#sig.delete(id); this.#next.delete(id); }
    for (const job of jobs) {
      const sig = `${job.enabled}|${job.cron}`;
      if (this.#sig.get(job.id) === sig) continue;
      this.#sig.set(job.id, sig);
      if (job.enabled) this.#plan(job, from); else this.#next.delete(job.id);
    }
    this.#synced = now.getTime();
  }

  #resync(): void {
    if (!this.#started) return;
    this.#sync(this.#now());
    this.#arm();
  }

  // Recheck wall time at least every minute so machine sleep cannot delay a job for hours after wake, and so a job
  // written by another process is noticed even when this scheduler has none armed.
  #arm(): void {
    this.#cancel?.();
    this.#cancel = undefined;
    if (!this.#started) return;
    const delay = Math.min(Math.max((this.#next.size ? Math.min(...this.#next.values()) : Infinity) - this.#now().getTime(), 0), 60_000);
    this.#cancel = (this.#opts.setTimer ?? defaultSetTimer)(() => this.#tick(), delay);
  }

  #tick(): void {
    if (!this.#started) return;
    const now = this.#now();
    this.#sync(now, new Date(this.#synced)); // a job another process added since the last look still fires if it came due meanwhile
    for (const [id, at] of [...this.#next]) {
      if (at > now.getTime()) continue;
      const job = this.#find(id);
      if (!job?.enabled) { this.#next.delete(id); continue; }
      this.#plan(job, now);
      // The store may be closed during shutdown; nothing useful to do with that error.
      void this.#fire(job).catch(() => {});
    }
    this.#arm();
  }

  async #fire(job: Job): Promise<void> {
    if (this.#running.has(job.id)) return; // the previous run is still going: skip this one
    this.#running.add(job.id);
    const record = (patch: Partial<Job>) => {
      const cur = this.#find(job.id); // the job may have been removed meanwhile; do not resurrect it
      if (cur) this.#opts.store.saveJob({ ...cur, ...patch });
    };
    try {
      record({ lastRunAt: this.#now().getTime(), lastStatus: 'running' });
      let status = 'ok';
      try { await this.#opts.onFire(job); } catch (e) { status = `error: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`; }
      record({ lastStatus: status });
    } finally {
      this.#running.delete(job.id);
    }
  }
}

// ---- tools

const fail = (content: string): ToolResult => ({ content, isError: true });
const when = (ms: number) => new Date(ms).toLocaleString('sv-SE').slice(0, 16); // local "YYYY-MM-DD HH:mm"
const where = (d: Delivery) => (d.kind === 'line' ? `line:${d.to}` : 'desktop');

export function scheduleTools(scheduler: Scheduler, agentId: string): Tool[] {
  const create: Tool = {
    name: 'schedule_create',
    description: 'Schedule a prompt to run on a cron schedule (5 fields: minute hour day-of-month month day-of-week, local time; '
      + 'e.g. "0 9 * * MON-FRI"). The result is delivered to this chat when called from LINE, otherwise to the desktop app.',
    inputSchema: {
      type: 'object',
      properties: {
        cron: { type: 'string', description: 'Five-field cron expression' },
        prompt: { type: 'string', description: 'What to do each time; written as a self-contained instruction' },
        delivery: { type: 'string', enum: ['origin', 'desktop'], description: '"origin" (default) = this LINE chat if called from LINE, else desktop' },
      },
      required: ['cron', 'prompt'],
    },
    defaultPolicy: 'ask',
    async run(input, ctx) {
      if (typeof input.cron !== 'string' || typeof input.prompt !== 'string') return fail('cron and prompt must be strings');
      if (input.delivery !== undefined && input.delivery !== 'origin' && input.delivery !== 'desktop') return fail('delivery must be "origin" or "desktop"');
      const delivery: Delivery = ctx.origin.kind === 'line' && input.delivery !== 'desktop' ? { kind: 'line', to: ctx.origin.to } : { kind: 'desktop' };
      try {
        const job = scheduler.add({ cron: input.cron, prompt: input.prompt, delivery, agentId });
        const next = scheduler.list().find((j) => j.id === job.id)?.nextRunAt;
        return { content: `Scheduled job ${job.id}: "${job.cron}" → ${where(delivery)}${next ? `, next run ${when(next)}` : ''}.` };
      } catch (e) { return fail((e as Error).message); }
    },
  };
  const list: Tool = {
    name: 'schedule_list',
    description: 'List scheduled jobs.',
    inputSchema: { type: 'object', properties: {} },
    defaultPolicy: 'allow',
    async run() {
      const jobs = scheduler.list().filter(j => j.agentId === agentId);
      if (!jobs.length) return { content: 'No scheduled jobs.' };
      return {
        content: jobs.map((j) => [
          j.id, j.cron, j.enabled ? 'on' : 'off', where(j.delivery),
          j.nextRunAt ? `next ${when(j.nextRunAt)}` : 'no next run',
          j.lastRunAt ? `last ${when(j.lastRunAt)} ${j.lastStatus ?? ''}`.trim() : 'never run',
          j.prompt.length > 80 ? `${j.prompt.slice(0, 79)}…` : j.prompt,
        ].join(' | ')).join('\n'),
      };
    },
  };
  const del: Tool = {
    name: 'schedule_delete',
    description: 'Delete a scheduled job by id (see schedule_list).',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    defaultPolicy: 'allow',
    async run(input) {
      const id = typeof input.id === 'string' ? input.id.trim() : '';
      return id && scheduler.list().some(j => j.id === id && j.agentId === agentId) && scheduler.remove(id) ? { content: `Deleted job ${id}.` } : fail(`No job with id "${id}".`);
    },
  };
  return [create, list, del];
}
