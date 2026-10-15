import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startupView, waitForReady, waitForStop } from '../../src/os/startup.ts';
import type { OsStatus, StartupActions } from '../../src/os/startup.ts';
import { installDom } from '../dom-fixture.ts';
import type { TestNode } from '../dom-fixture.ts';

const view = (status: OsStatus, actions: StartupActions) => startupView(status, actions) as unknown as TestNode;
const buttons = (n: TestNode) => n.querySelectorAll('button');

test('Docker stopped shows Open Docker and Retry', () => {
  const restore = installDom();
  try {
    const calls: string[] = [];
    const root = view({ phase: 'docker-stopped', installed: true }, { retry: () => calls.push('retry'), openDocker: () => calls.push('open') });
    assert.deepEqual(buttons(root).map((b) => b.textContent), ['Open Docker', 'Retry']);
    assert.match(root.textContent, /Docker is not running/);
    buttons(root).forEach((b) => b.fire('click'));
    assert.deepEqual(calls, ['open', 'retry']);
    assert.equal(root.attrs.role, 'alert');
  } finally { restore(); }
});

test('Docker missing offers only Retry and says to install it', () => {
  const restore = installDom();
  try {
    const root = view({ phase: 'docker-stopped', installed: false }, { retry() {}, openDocker() {} });
    assert.deepEqual(buttons(root).map((b) => b.textContent), ['Retry']);
    assert.match(root.textContent, /not installed/);
  } finally { restore(); }
});

test('a failure shows its title and message with Retry; progress shows the step and the last line', () => {
  const restore = installDom();
  try {
    const failed = view({ phase: 'failed', title: 'ERP folder not found', message: 'set BIGNOSE_OS_ERP_DIR' }, { retry() {}, openDocker() {} });
    assert.match(failed.textContent, /ERP folder not found/);
    assert.match(failed.textContent, /BIGNOSE_OS_ERP_DIR/);
    assert.deepEqual(buttons(failed).map((b) => b.textContent), ['Retry']);
    const starting = view({ phase: 'starting', step: 'database', detail: 'applying 0026' }, { retry() {}, openDocker() {} });
    assert.match(starting.textContent, /Starting the local database/);
    assert.match(starting.textContent, /applying 0026/);
    assert.equal(buttons(starting).length, 0);
  } finally { restore(); }
});

test('waitForReady shows each change once, wires Retry to os_retry, and resolves with the ERP url', async () => {
  const restore = installDom();
  try {
    const script: OsStatus[] = [
      { phase: 'docker-stopped', installed: true }, { phase: 'docker-stopped', installed: true },
      { phase: 'starting', step: 'erp', detail: null }, { phase: 'ready', url: 'http://127.0.0.1:3100' },
    ];
    const calls: string[] = [];
    const shown: TestNode[] = [];
    const invoke = (async (cmd: string) => {
      calls.push(cmd);
      return cmd === 'os_status' ? script.shift() : undefined;
    }) as Parameters<typeof waitForReady>[0];
    const url = await waitForReady(invoke, (v) => shown.push(v as unknown as TestNode), 1);
    assert.equal(url, 'http://127.0.0.1:3100');
    assert.equal(shown.length, 2); // the repeated Docker screen is not re-rendered
    buttons(shown[0]!).find((b) => b.textContent === 'Retry')!.fire('click');
    buttons(shown[0]!).find((b) => b.textContent === 'Open Docker')!.fire('click');
    assert.deepEqual(calls.slice(-2), ['os_retry', 'os_open_docker']);
  } finally { restore(); }
});

test('an ERP server exit after Ready shows the error with Retry', async () => {
  const restore = installDom();
  try {
    const ready: OsStatus = { phase: 'ready', url: 'http://127.0.0.1:3100' };
    const failed: OsStatus = { phase: 'failed', title: 'The ERP server stopped', message: 'exit status 1' };
    let script: (OsStatus | Error)[] = [ready, ready, new Error('bridge hiccup'), ready, failed];
    const calls: string[] = [];
    const invoke = (async (cmd: string) => {
      calls.push(cmd);
      if (cmd !== 'os_status') return undefined;
      const next = script.shift() ?? failed;
      if (next instanceof Error) throw next;
      return next;
    }) as Parameters<typeof waitForReady>[0];
    // the panel keeps watching after Ready: a hiccup in the bridge is not a stop, the launcher leaving ready is
    const stopped = await waitForStop(invoke, new AbortController().signal, 1);
    assert.deepEqual(stopped, failed);
    assert.equal(script.length, 0);
    // boot() then runs the startup screen again: it shows why the server stopped, with Retry wired to os_retry
    script = [failed, failed, { phase: 'starting', step: 'erp', detail: null }, ready];
    const shown: TestNode[] = [];
    assert.equal(await waitForReady(invoke, (v) => shown.push(v as unknown as TestNode), 1), 'http://127.0.0.1:3100');
    assert.match(shown[0]!.textContent, /The ERP server stopped/);
    assert.match(shown[0]!.textContent, /exit status 1/);
    assert.equal(shown[0]!.attrs.role, 'alert');
    assert.deepEqual(buttons(shown[0]!).map((b) => b.textContent), ['Retry']);
    buttons(shown[0]!)[0]!.fire('click');
    assert.equal(calls.at(-1), 'os_retry');
    assert.match(shown[1]!.textContent, /Starting the ERP/);
  } finally { restore(); }
});

test('waitForStop ends quietly when it is aborted', async () => {
  const restore = installDom();
  try {
    const abort = new AbortController();
    const invoke = (async () => ({ phase: 'ready', url: 'http://127.0.0.1:3100' })) as unknown as Parameters<typeof waitForReady>[0];
    const waiting = waitForStop(invoke, abort.signal, 1);
    abort.abort();
    assert.equal(await waiting, null);
  } finally { restore(); }
});
