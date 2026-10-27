import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const tauri = new URL('../../src-tauri/', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, tauri), 'utf8');
interface Capability { identifier: string; windows?: string[]; webviews?: string[]; remote?: unknown; permissions: unknown[] }
const capabilities = readdirSync(new URL('capabilities/', tauri)).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(read(`capabilities/${f}`)) as Capability);
const label = (name: string) => new RegExp(`pub const ${name}: &str = "([a-z-]+)";`).exec(read('src/shell.rs'))?.[1];

test('the ERP webview gets no IPC', () => {
  const erp = label('ERP'), panel = label('PANEL');
  assert.equal(erp, 'erp');
  assert.equal(panel, 'panel');
  assert.ok(capabilities.length > 0);
  for (const c of capabilities) {
    // `windows` would cover every webview of the window, the ERP included; `remote` would let a remote page call IPC
    assert.equal(c.windows, undefined, `${c.identifier} must name webviews, not windows`);
    assert.equal(c.remote, undefined, `${c.identifier} must not grant remote origins`);
    assert.ok(!(c.webviews ?? []).includes(erp!), `${c.identifier} must not name the ERP webview`);
    assert.ok(!(c.webviews ?? []).some((w) => w.includes('*')), `${c.identifier} must not use a webview pattern`);
  }
  assert.deepEqual([...new Set(capabilities.flatMap((c) => c.webviews ?? []))], [panel]);
});

test('capabilities come only from the capabilities folder, and the ERP is an external page', () => {
  const conf = JSON.parse(read('tauri.conf.json')) as { productName: string; identifier: string; app: { security: { capabilities?: unknown }; windows: { label: string; title: string; create?: boolean }[] } };
  assert.equal(conf.app.security.capabilities, undefined);
  // the window is built in code (shell.rs), so no config window carries a webview of its own
  assert.deepEqual(conf.app.windows.map((w) => [w.label, w.create]), [['main', false]]);
  assert.equal(conf.app.windows[0]!.title, 'BoomBigNose');
  assert.equal(conf.productName, 'BoomBigNose');
  assert.equal(conf.identifier, 'com.boombignose.bignose');
  const shell = read('src/shell.rs');
  assert.match(shell, /WebviewUrl::External\(url\)/);
  assert.match(shell, /WebviewUrl::App\("index\.html"\.into\(\)\)/);
  assert.match(read('Cargo.toml'), /features = \["unstable"\]/);
});
