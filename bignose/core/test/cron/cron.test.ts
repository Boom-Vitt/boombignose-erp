import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { nextRun, parseCron, Scheduler, scheduleTools } from '../../src/cron/index.ts';
import { openStore } from '../../src/store/index.ts';
import type { Job, Store } from '../../src/store/index.ts';
import type { ToolContext } from '../../src/types.ts';

// ---- helpers (all local time, so the suite does not depend on the machine's time zone)
const at = (y: number, mo: number, d: number, h = 0, mi = 0, s = 0, ms = 0) => new Date(y, mo - 1, d, h, mi, s, ms);
const pad = (n: number) => String(n).padStart(2, '0');
const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const next = (expr: string, after: Date) => fmt(nextRun(expr, after));
// the n runs that follow `after`
function runs(expr: string, after: Date, n: number): string[] {
  const out: string[] = [];
  for (let d = after; out.length < n;) { d = nextRun(expr, d); out.push(fmt(d)); }
  return out;
}
const flush = () => new Promise((r) => setImmediate(r));

test('parseCron: fields, lists, ranges, steps, names, Sunday as 0 and 7', () => {
  const c = parseCron('*/15 9-17/4 1,15 JAN,mar-may 7');
  assert.deepEqual([...c.minute], [0, 15, 30, 45]);
  assert.deepEqual([...c.hour], [9, 13, 17]);
  assert.deepEqual([...c.dom], [1, 15]);
  assert.deepEqual([...c.month].sort((a, b) => a - b), [1, 3, 4, 5]);
  assert.deepEqual([...c.dow], [0], '7 is Sunday');
  assert.deepEqual([...parseCron('5/20 * * * *').minute], [5, 25, 45], 'n/step runs to the end');
  assert.deepEqual([...parseCron('* * * * mon-fri').dow], [1, 2, 3, 4, 5]);
  assert.deepEqual([...parseCron('* * * * 5-7').dow].sort(), [0, 5, 6]);
  assert.deepEqual([...parseCron('  0   0 * *  SUN ').dow], [0], 'extra whitespace is fine');
  assert.equal(parseCron('* * * * *').domRestricted, false);
  assert.equal(parseCron('* * 1-31 * 0-6').dowRestricted, false, 'matching everything is not a restriction');
  assert.equal(parseCron('* * */2 * *').domRestricted, true);
});

test('nextRun: */15 and strictly after', () => {
  assert.equal(next('*/15 * * * *', at(2026, 10, 13, 10, 7, 30)), '2026-10-13 10:15');
  assert.equal(next('*/15 * * * *', at(2026, 10, 13, 10, 15)), '2026-10-13 10:30', 'exactly on a run → the following one');
  assert.equal(next('*/15 * * * *', at(2026, 10, 13, 10, 14, 59, 999)), '2026-10-13 10:15');
  assert.equal(next('*/15 * * * *', at(2026, 10, 13, 10, 45, 0, 1)), '2026-10-13 11:00');
  assert.equal(next('* * * * *', at(2026, 10, 13, 23, 59)), '2026-10-14 00:00');
  const d = nextRun('0 9 * * *', at(2026, 10, 13, 8, 59, 59));
  assert.equal(d.getSeconds() + d.getMilliseconds(), 0);
  assert.ok(nextRun('*/7 * * * *', at(2026, 10, 13)).getTime() > at(2026, 10, 13).getTime());
});

test('nextRun: ranges with steps and lists', () => {
  assert.deepEqual(runs('10-30/10 9 * * *', at(2026, 10, 13, 9), 4), ['2026-10-13 09:10', '2026-10-13 09:20', '2026-10-13 09:30', '2026-10-14 09:10']);
  assert.deepEqual(runs('0 9,17 * * *', at(2026, 10, 13, 8), 3), ['2026-10-13 09:00', '2026-10-13 17:00', '2026-10-14 09:00']);
  assert.deepEqual(runs('5/20 3 * * *', at(2026, 10, 13), 4), ['2026-10-13 03:05', '2026-10-13 03:25', '2026-10-13 03:45', '2026-10-14 03:05']);
  assert.deepEqual(runs('0 8-10/2,20 * * *', at(2026, 10, 13), 4), ['2026-10-13 08:00', '2026-10-13 10:00', '2026-10-13 20:00', '2026-10-14 08:00']);
});

test('nextRun: weekday and month names, MON-FRI, 0/7 = Sunday', () => {
  assert.equal(at(2026, 10, 16).getDay(), 5, 'sanity: 2026-10-16 is a Friday');
  assert.deepEqual(runs('0 9 * * MON-FRI', at(2026, 10, 15, 10), 4), ['2026-10-16 09:00', '2026-10-19 09:00', '2026-10-20 09:00', '2026-10-21 09:00']);
  assert.deepEqual(runs('0 9 * * mon-fri', at(2026, 10, 15, 10), 2), ['2026-10-16 09:00', '2026-10-19 09:00'], 'case-insensitive');
  assert.equal(next('0 8 * * 7', at(2026, 10, 13)), '2026-10-18 08:00');
  assert.equal(next('0 8 * * 0', at(2026, 10, 13)), '2026-10-18 08:00');
  assert.equal(next('0 8 * * SUN', at(2026, 10, 13)), '2026-10-18 08:00');
  assert.deepEqual(runs('0 8 * * 5-7', at(2026, 10, 15), 4), ['2026-10-16 08:00', '2026-10-17 08:00', '2026-10-18 08:00', '2026-10-23 08:00']);
  assert.equal(next('30 6 1 JAN *', at(2026, 10, 13)), '2027-01-01 06:30');
  assert.equal(next('0 0 1 jul-sep *', at(2026, 10, 13)), '2027-07-01 00:00');
  assert.deepEqual(runs('0 0 15 */3 *', at(2026, 10, 13), 3), ['2026-10-15 00:00', '2027-01-15 00:00', '2027-04-15 00:00'], '*/3 months = Jan, Apr, Jul, Oct');
});

test('nextRun: day-of-month and day-of-week both restricted match either', () => {
  // 13th of the month OR any Friday
  assert.deepEqual(runs('0 0 13 * FRI', at(2026, 10, 1), 7),
    ['2026-10-02 00:00', '2026-10-09 00:00', '2026-10-13 00:00', '2026-10-16 00:00', '2026-10-23 00:00', '2026-10-30 00:00', '2026-11-06 00:00']);
  assert.deepEqual(runs('0 0 13 * *', at(2026, 10, 1), 2), ['2026-10-13 00:00', '2026-11-13 00:00'], 'only dom restricted');
  assert.deepEqual(runs('0 0 * * FRI', at(2026, 10, 1), 2), ['2026-10-02 00:00', '2026-10-09 00:00'], 'only dow restricted');
  assert.deepEqual(runs('0 0 1-31 * MON', at(2026, 10, 1), 2), ['2026-10-05 00:00', '2026-10-12 00:00'], '1-31 is no restriction');
  assert.equal(next('0 0 13 3 FRI', at(2026, 10, 13, 1)), '2027-03-05 00:00', 'month still has to match: first Friday of March 2027');
});

test('nextRun: month and year rollover', () => {
  assert.equal(next('0 0 31 * *', at(2026, 4, 15)), '2026-05-31 00:00', 'April has no 31st');
  assert.deepEqual(runs('0 0 31 * *', at(2026, 1, 31, 12), 4), ['2026-03-31 00:00', '2026-05-31 00:00', '2026-07-31 00:00', '2026-08-31 00:00']);
  assert.equal(next('0 0 1 * *', at(2026, 12, 31, 12)), '2027-01-01 00:00');
  assert.equal(next('59 23 31 12 *', at(2026, 12, 31, 23, 59)), '2027-12-31 23:59');
  assert.equal(next('0 0 1 1 *', at(2026, 1, 1)), '2027-01-01 00:00');
  assert.equal(next('0 12 * * *', at(2026, 12, 31, 13)), '2027-01-01 12:00');
});

test('nextRun: Feb 29 jobs', () => {
  assert.equal(next('0 0 29 2 *', at(2026, 1, 1)), '2028-02-29 00:00');
  assert.equal(next('0 0 29 2 *', at(2028, 2, 29)), '2032-02-29 00:00');
  assert.equal(next('0 0 29 2 *', at(2096, 3, 1)), '2104-02-29 00:00', '2100 is not a leap year');
  assert.equal(next('0 0 29 FEB *', at(2027, 3, 1)), '2028-02-29 00:00');
});

test('nextRun throws for expressions that can never match', () => {
  assert.throws(() => nextRun('0 0 31 2 *', at(2026, 1, 1)), /never runs/);
  assert.throws(() => nextRun('0 0 30 FEB *', at(2026, 1, 1)), /never runs/);
  assert.throws(() => nextRun('0 0 31 4,6,9,11 *', at(2026, 1, 1)), /never runs/);
});

test('invalid expressions throw clear errors', () => {
  const bad: [string, RegExp][] = [
    ['', /expected 5 fields.*got 0/],
    ['* * * *', /expected 5 fields.*got 4/],
    ['* * * * * *', /expected 5 fields.*got 6/],
    ['@daily', /expected 5 fields/],
    ['60 * * * *', /minute: 60 is out of range 0-59/],
    ['* 24 * * *', /hour: 24 is out of range 0-23/],
    ['* * 0 * *', /day-of-month: 0 is out of range 1-31/],
    ['* * 32 * *', /day-of-month: 32 is out of range/],
    ['* * * 13 *', /month: 13 is out of range 1-12/],
    ['* * * 0 *', /month: 0 is out of range/],
    ['* * * * 8', /day-of-week: 8 is out of range 0-7/],
    ['*/0 * * * *', /step must be at least 1/],
    ['*/x * * * *', /bad step "x"/],
    ['*/ * * * *', /bad step/],
    ['*/5/2 * * * *', /bad step/],
    ['5-1 * * * *', /runs backwards/],
    ['1-2-3 * * * *', /bad range/],
    ['a * * * *', /unknown value "a"/],
    ['* * * FOO *', /month: unknown value "FOO"/],
    ['* * * * FUNDAY', /day-of-week: unknown value "FUNDAY"/],
    ['1,,2 * * * *', /unknown value ""/],
    ['* * * * ?', /unknown value "\?"/],
    ['-5 * * * *', /unknown value ""/],
    ['1.5 * * * *', /unknown value "1.5"/],
    ['FRI-MON * * * *', /minute: unknown value/],
    ['* * * * FRI-MON', /runs backwards/],
  ];
  for (const [expr, re] of bad) {
    assert.throws(() => parseCron(expr), (e: Error) => re.test(e.message) && e.message.startsWith(`invalid cron "${expr}"`), expr);
    assert.throws(() => nextRun(expr, new Date()), /invalid cron/, `nextRun ${expr}`);
  }
});

test('nextRun across daylight-saving changes (America/New_York)', (t) => {
  const prev = process.env.TZ;
  process.env.TZ = 'America/New_York';
  t.after(() => { if (prev === undefined) delete process.env.TZ; else process.env.TZ = prev; });
  assert.equal(new Date('2026-03-08T12:00:00Z').getTimezoneOffset(), 240, 'TZ took effect');
  // spring forward 2026-03-08: 02:30 does not exist that day
  assert.equal(next('30 2 * * *', at(2026, 3, 7, 12)), '2026-03-09 02:30');
  assert.equal(next('30 3 * * *', at(2026, 3, 7, 12)), '2026-03-08 03:30');
  // fall back 2026-11-01: 01:30 happens twice; runs once, and the result is always strictly after
  const first = nextRun('30 1 * * *', at(2026, 10, 31, 12));
  assert.equal(fmt(first), '2026-11-01 01:30');
  const secondOccurrence = new Date(first.getTime() + 3_600_000);
  assert.equal(fmt(secondOccurrence), '2026-11-01 01:30');
  assert.equal(next('30 1 * * *', first), '2026-11-02 01:30', 'the first occurrence must not schedule the repeated one');
  const after = nextRun('30 1 * * *', secondOccurrence);
  assert.ok(after.getTime() > secondOccurrence.getTime());
  assert.equal(fmt(after), '2026-11-02 01:30');
  assert.equal(next('*/30 * * * *', secondOccurrence), '2026-11-01 02:00');
});

// ---- Scheduler

function harness(t: { after(fn: () => void): void }, o: { store?: Store; start?: Date; onFire?: (job: Job) => Promise<void> } = {}) {
  const store = o.store ?? openStore(':memory:');
  store.ensureDefaultAgent({ provider: 'mock', model: 'test' });
  if (!o.store) t.after(() => store.close());
  let clock = (o.start ?? at(2026, 10, 13, 10, 2)).getTime();
  const timers: { fn: () => void; ms: number; cancelled: boolean }[] = [];
  const fired: Job[] = [];
  const sched = new Scheduler({
    store,
    onFire: async (job) => { fired.push(job); await o.onFire?.(job); },
    now: () => new Date(clock),
    setTimer: (fn, ms) => { const h = { fn, ms, cancelled: false }; timers.push(h); return () => { h.cancelled = true; }; },
  });
  t.after(() => sched.stop());
  return {
    store, sched, fired, timers,
    live: () => timers.filter((x) => !x.cancelled),
    setClock: (d: Date) => { clock = d.getTime(); },
    // the clock reaches `d` and the pending timer fires
    async advance(d: Date) {
      clock = d.getTime();
      const h = timers.filter((x) => !x.cancelled).at(-1);
      assert.ok(h, 'a timer is armed');
      h.fn();
      await flush();
    },
  };
}
const desktop = { kind: 'desktop' } as const;

test('scheduler: arms for the next run, fires onFire, records the last run', async (t) => {
  const h = harness(t); // 10:02
  const job = h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '*/5 * * * *', prompt: 'ping', delivery: desktop });
  assert.equal(h.live().length, 0, 'not started yet: no timer');
  h.sched.start();
  assert.equal(h.live().length, 1);
  assert.equal(h.live()[0]!.ms, 60_000, 'recheck the wall clock before 10:05');

  await h.advance(at(2026, 10, 13, 10, 5));
  assert.equal(h.fired.length, 1);
  assert.equal(h.fired[0]!.id, job.id);
  assert.equal(h.fired[0]!.prompt, 'ping');
  const stored = h.store.listJobs()[0]!;
  assert.equal(stored.lastRunAt, at(2026, 10, 13, 10, 5).getTime());
  assert.equal(stored.lastStatus, 'ok');
  assert.equal(h.live().length, 1, 're-armed');
  assert.equal(h.live()[0]!.ms, 60_000);

  await h.advance(at(2026, 10, 13, 10, 10));
  assert.equal(h.fired.length, 2);
  h.sched.stop();
  assert.equal(h.live().length, 0, 'stop cancels the timer');
});

test('scheduler: jobs persist and a new Scheduler on the same store reloads them (restart)', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bn-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'bignose.db');

  const store1 = openStore(file);
  const h1 = harness(t, { store: store1, start: at(2026, 10, 13, 8) });
  const job = h1.sched.add({ agentId: h1.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'brief me', delivery: { kind: 'line', to: 'Cabc' } });
  h1.sched.start();
  h1.sched.stop();
  store1.close();

  const store2 = openStore(file);
  t.after(() => store2.close());
  const h2 = harness(t, { store: store2, start: at(2026, 10, 13, 8, 30) });
  assert.deepEqual(h2.sched.list().map((j) => j.id), [job.id], 'persisted');
  h2.sched.start();
  assert.equal(h2.live()[0]!.ms, 60_000, 'reloaded and checking the wall clock before 09:00');
  await h2.advance(at(2026, 10, 13, 9));
  assert.deepEqual(h2.fired.map((j) => [j.id, j.prompt, j.delivery]), [[job.id, 'brief me', { kind: 'line', to: 'Cabc' }]]);
});

test('scheduler: runs missed while stopped are skipped, not replayed', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 8) });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'daily', delivery: desktop });
  h.sched.start();
  h.sched.stop();
  h.setClock(at(2026, 10, 14, 12)); // a day later: the 10-13 09:00 and 10-14 09:00 runs were missed
  h.sched.start();
  assert.equal(h.fired.length, 0, 'nothing replayed on start');
  assert.equal(h.live().at(-1)!.ms, 60_000);
  assert.equal(fmt(new Date(h.sched.list()[0]!.nextRunAt!)), '2026-10-15 09:00');
  await h.advance(at(2026, 10, 15, 9));
  assert.equal(h.fired.length, 1);
});

test('scheduler: disabled jobs do not fire; enabling and disabling takes effect live', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 8) });
  const a = h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'a', delivery: desktop });
  const b = h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'b', delivery: desktop });
  assert.equal(h.sched.setEnabled(b.id, false), true);
  assert.equal(h.sched.setEnabled('nope', true), false);
  h.sched.start();
  await h.advance(at(2026, 10, 13, 9));
  assert.deepEqual(h.fired.map((j) => j.prompt), ['a']);
  assert.equal(h.store.listJobs().find((j) => j.id === b.id)!.lastRunAt, undefined);

  h.sched.setEnabled(b.id, true);
  await h.advance(at(2026, 10, 14, 9));
  assert.deepEqual(h.fired.map((j) => j.prompt).sort(), ['a', 'a', 'b']);

  h.sched.setEnabled(a.id, false);
  h.sched.setEnabled(b.id, false);
  assert.deepEqual(h.live().map((x) => x.ms), [60_000], 'no enabled jobs: the only timer is the minute check of the store for jobs another process adds');
  assert.equal(h.sched.list().every((j) => j.nextRunAt === undefined), true);

  // disabled before start: reload keeps it off
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.saveJob({ agentId: store.ensureDefaultAgent({ provider: 'mock', model: 'test' }).id, id: 'off', cron: '* * * * *', prompt: 'x', delivery: desktop, enabled: false });
  const h2 = harness(t, { store });
  h2.sched.start();
  assert.deepEqual(h2.live().map((x) => x.ms), [60_000], 'only the store check is armed');
  await h2.advance(at(2026, 10, 13, 10, 3));
  assert.equal(h2.fired.length, 0, 'the disabled job still does not fire');
});

test('scheduler: a failing onFire is recorded and does not stop the schedule', async (t) => {
  let calls = 0;
  const h = harness(t, { start: at(2026, 10, 13, 8), onFire: async () => { if (++calls === 1) throw new Error('boom'); } });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 * * * *', prompt: 'x', delivery: desktop });
  h.sched.start();
  await h.advance(at(2026, 10, 13, 9));
  assert.equal(h.store.listJobs()[0]!.lastStatus, 'error: boom');
  await h.advance(at(2026, 10, 13, 10));
  assert.equal(h.store.listJobs()[0]!.lastStatus, 'ok');
  assert.equal(h.fired.length, 2);
});

test('scheduler: a job that is still running is not started twice, and a removed job is not resurrected', async (t) => {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  const h = harness(t, { start: at(2026, 10, 13, 8), onFire: () => gate });
  const job = h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 * * * *', prompt: 'slow', delivery: desktop });
  h.sched.start();
  await h.advance(at(2026, 10, 13, 9));
  assert.equal(h.store.listJobs()[0]!.lastStatus, 'running');
  await h.advance(at(2026, 10, 13, 10));
  assert.equal(h.fired.length, 1, 'second tick skipped while the first run is going');
  assert.equal(h.sched.remove(job.id), true);
  release();
  await flush();
  assert.deepEqual(h.store.listJobs(), [], 'finishing a removed job does not save it again');
  assert.equal(h.sched.remove(job.id), false);
});

// `bignose chat -q` runs its own Scheduler on the same database file but never starts it; only the daemon fires.
test('a job added by another process fires in the running daemon, and its changes and removal follow', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 8) });
  h.sched.start(); // the daemon, with no job yet
  const cli = new Scheduler({ store: h.store, onFire: async () => {} });
  const agentId = h.store.listAgents()[0]!.id;
  const job = cli.add({ agentId, cron: '0 9 * * *', prompt: 'from the CLI', delivery: desktop });
  await h.advance(at(2026, 10, 13, 8, 1)); // the daemon's minute check finds it
  assert.equal(h.sched.list().find((j) => j.id === job.id)!.nextRunAt, at(2026, 10, 13, 9).getTime());
  await h.advance(at(2026, 10, 13, 9));
  assert.deepEqual(h.fired.map((j) => j.id), [job.id]);
  assert.equal(h.store.listJobs()[0]!.lastStatus, 'ok');

  cli.setEnabled(job.id, false); // switched off by the other process
  await h.advance(at(2026, 10, 14, 9));
  assert.equal(h.fired.length, 1, 'a job switched off elsewhere does not fire');
  cli.setEnabled(job.id, true);
  const other = cli.add({ agentId, cron: '0 10 * * *', prompt: 'second', delivery: desktop });
  cli.remove(other.id); // added and removed between two checks: never planned
  await h.advance(at(2026, 10, 14, 9, 30));
  await h.advance(at(2026, 10, 15, 9));
  assert.deepEqual(h.fired.map((j) => j.prompt), ['from the CLI', 'from the CLI'], 'switched on again, fired once more; the removed job never fired');
});

test('a job added by another process fires in the running daemon even when it came due between two checks', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 8) });
  h.sched.start();
  new Scheduler({ store: h.store, onFire: async () => {} }).add({ agentId: h.store.listAgents()[0]!.id, cron: '1 8 * * *', prompt: 'due at 08:01', delivery: desktop });
  await h.advance(at(2026, 10, 13, 8, 2)); // the daemon looks after the minute has passed
  assert.deepEqual(h.fired.map((j) => j.prompt), ['due at 08:01']);
});

test('scheduler: every due job fires in one tick', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 8) });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'one', delivery: desktop });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 9 * * *', prompt: 'two', delivery: desktop });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 12 * * *', prompt: 'later', delivery: desktop });
  h.sched.start();
  await h.advance(at(2026, 10, 13, 9));
  assert.deepEqual(h.fired.map((j) => j.prompt).sort(), ['one', 'two']);
  assert.equal(h.live().at(-1)!.ms, 60_000, 'recheck before the 12:00 job');
});

test('scheduler: long waits recheck the wall clock at least every minute', async (t) => {
  const h = harness(t, { start: at(2026, 1, 1) });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 0 1 1 *', prompt: 'yearly', delivery: desktop });
  h.sched.start();
  assert.ok(h.live()[0]!.ms <= 60_000);
  await h.advance(at(2026, 2, 1)); // timer fires early: nothing is due yet
  assert.equal(h.fired.length, 0);
  assert.ok(h.live().length === 1 && h.live()[0]!.ms <= 60_000);
  await h.advance(at(2027, 1, 1));
  assert.equal(h.fired.length, 1);
});

test('scheduler: waking past a due run fires once and plans from the current wall clock', async (t) => {
  const h = harness(t, { start: at(2026, 10, 13, 7) });
  h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 8 * * *', prompt: 'daily', delivery: desktop });
  h.sched.start();
  assert.ok(h.live()[0]!.ms <= 60_000);
  await h.advance(at(2026, 10, 13, 7, 1));
  assert.equal(h.fired.length, 0);
  await h.advance(at(2026, 10, 15, 10, 30)); // asleep across several due times
  assert.equal(h.fired.length, 1, 'one delivery on wake, no replay of each missed run');
  assert.equal(h.store.listJobs()[0]!.lastRunAt, at(2026, 10, 15, 10, 30).getTime());
  assert.equal(fmt(new Date(h.sched.list()[0]!.nextRunAt!)), '2026-10-16 08:00');
  await h.advance(at(2026, 10, 15, 10, 31));
  assert.equal(h.fired.length, 1);
  await h.advance(at(2026, 10, 16, 8));
  assert.equal(h.fired.length, 2);
});

test('scheduler: add validates and trims; list reports the next run', (t) => {
  const h = harness(t); // 10:02
  assert.throws(() => h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: 'nope', prompt: 'x', delivery: desktop }), /invalid cron/);
  assert.throws(() => h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '0 0 31 2 *', prompt: 'x', delivery: desktop }), /never runs/);
  assert.throws(() => h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '* * * * *', prompt: '  ', delivery: desktop }), /prompt is required/);
  assert.deepEqual(h.store.listJobs(), [], 'nothing persisted on failure');
  const job = h.sched.add({ agentId: h.store.listAgents()[0]!.id, cron: '  0   9 * *  MON ', prompt: ' hello ', delivery: desktop });
  assert.equal(job.cron, '0 9 * * MON');
  assert.equal(job.prompt, 'hello');
  assert.match(job.id, /^[0-9a-f]{8}$/);
  const [listed] = h.sched.list();
  assert.equal(fmt(new Date(listed!.nextRunAt!)), '2026-10-19 09:00');
  assert.equal(listed!.enabled, true);
});

test('scheduler: a persisted job with a bad cron is skipped, not fatal', async (t) => {
  const store = openStore(':memory:');
  t.after(() => store.close());
  store.saveJob({ agentId: store.ensureDefaultAgent({ provider: 'mock', model: 'test' }).id, id: 'bad', cron: 'garbage', prompt: 'x', delivery: desktop, enabled: true });
  store.saveJob({ agentId: store.ensureDefaultAgent({ provider: 'mock', model: 'test' }).id, id: 'good', cron: '0 9 * * *', prompt: 'ok', delivery: desktop, enabled: true });
  const h = harness(t, { store, start: at(2026, 10, 13, 8) });
  h.sched.start();
  await h.advance(at(2026, 10, 13, 9));
  assert.deepEqual(h.fired.map((j) => j.id), ['good']);
  assert.equal(h.sched.list().find((j) => j.id === 'bad')!.nextRunAt, undefined);
});

// ---- tools

const ctxOf = (origin: ToolContext['origin']): ToolContext => ({ sessionId: 's', origin, cwd: '/', signal: new AbortController().signal, depth: 0 });

test('schedule tools: create (delivery follows the origin), list, delete', async (t) => {
  const h = harness(t);
  const [create, list, del] = scheduleTools(h.sched, h.store.listAgents()[0]!.id) as [any, any, any];
  assert.deepEqual([create.name, list.name, del.name], ['schedule_create', 'schedule_list', 'schedule_delete']);
  assert.deepEqual([create.defaultPolicy, list.defaultPolicy, del.defaultPolicy], ['ask', 'allow', 'allow']);
  assert.equal((await list.run({}, ctxOf({ kind: 'desktop' }))).content, 'No scheduled jobs.');

  const fromDesktop = await create.run({ cron: '0 9 * * *', prompt: 'morning' }, ctxOf({ kind: 'desktop' }));
  assert.equal(fromDesktop.isError, undefined);
  assert.match(fromDesktop.content, /Scheduled job [0-9a-f]{8}: "0 9 \* \* \*" → desktop, next run 2026-10-14 09:00/);
  await create.run({ cron: '0 10 * * *', prompt: 'from cli' }, ctxOf({ kind: 'cli' }));
  await create.run({ cron: '0 11 * * *', prompt: 'from line' }, ctxOf({ kind: 'line', to: 'Cabc' }));
  await create.run({ cron: '0 12 * * *', prompt: 'line but desktop', delivery: 'desktop' }, ctxOf({ kind: 'line', to: 'Cabc' }));
  await create.run({ cron: '0 13 * * *', prompt: 'from cron', delivery: 'origin' }, ctxOf({ kind: 'cron', jobId: 'j' }));
  const byPrompt = Object.fromEntries(h.store.listJobs().map((j) => [j.prompt, j.delivery]));
  assert.deepEqual(byPrompt, {
    morning: { kind: 'desktop' }, 'from cli': { kind: 'desktop' }, 'from line': { kind: 'line', to: 'Cabc' },
    'line but desktop': { kind: 'desktop' }, 'from cron': { kind: 'desktop' },
  });

  const listing = (await list.run({}, ctxOf({ kind: 'desktop' }))).content as string;
  assert.equal(listing.split('\n').length, 5);
  assert.match(listing, /\| 0 11 \* \* \* \| on \| line:Cabc \| next 2026-10-13 11:00 \| never run \| from line/);

  const id = h.store.listJobs()[0]!.id;
  assert.equal((await del.run({ id }, ctxOf({ kind: 'desktop' }))).content, `Deleted job ${id}.`);
  assert.equal(h.store.listJobs().length, 4);
  assert.equal((await del.run({ id }, ctxOf({ kind: 'desktop' }))).isError, true);
  assert.equal((await del.run({}, ctxOf({ kind: 'desktop' }))).isError, true);
});

test('schedule_create rejects bad input as an error result', async (t) => {
  const h = harness(t);
  const create = scheduleTools(h.sched, h.store.listAgents()[0]!.id)[0]!;
  const ctx = ctxOf({ kind: 'desktop' });
  for (const input of [{}, { cron: 'x', prompt: 'p' }, { cron: '* * * * *' }, { cron: '* * * * *', prompt: ' ' }, { cron: 5, prompt: 'p' }, { cron: '0 0 31 2 *', prompt: 'p' }, { cron: '* * * * *', prompt: 'p', delivery: 'line' }]) {
    const r = await create.run(input, ctx);
    assert.equal(r.isError, true, JSON.stringify(input));
  }
  assert.deepEqual(h.store.listJobs(), []);
});
