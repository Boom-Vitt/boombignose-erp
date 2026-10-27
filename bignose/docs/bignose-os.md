# BoomBigNose

BoomBigNose is the BigNose desktop app as one native window that shows the BoomBigNose ERP, with the BigNose agent
UI as a slide-out panel on the right. The app is `BoomBigNose.app` (`CFBundleName` `BoomBigNose`); the bundle identifier
stays `com.boombignose.bignose`, so the existing `~/.bignose` home, daemon, agents and LINE settings carry over.
Design record: `docs/decisions/0002-bignose-os.md`.

## What you see

- **The window** has two Tauri webviews (multiwebview, the `unstable` Cargo feature of `tauri`): the **ERP** fills
  the window, and the **BigNose panel** is docked on its right, 420 px wide.
- **The toggle** slides the panel in and out: the button at the panel's top right, `Cmd+J`, or
  View > Toggle BigNose Panel. Closed, the panel shrinks to a 40 px rail that still holds the button. The window opens
  with the panel open; the state is not remembered between launches.
- **In the panel** the chat opens on the **ERP assistant**. Agents, Chat and every Settings section are one click away
  in the strip at the top; it scrolls sideways and the page itself never scrolls (the panes scroll inside the window).
- **While starting**, the panel is the whole window and shows progress (checking Docker, starting the local
  database, starting the ERP; the first start builds the ERP and can take a few minutes) or the reason it stopped.

## How it starts

The Rust side finds the ERP folder, then runs `node <erp>/scripts/local/stack.mjs doctor`, `up` and
`serve --port 3100 --cache-dir <BIGNOSE_HOME>/erp` as managed children (see `docs/desktop/local-stack.md` in the ERP
for what those commands do). They use the login-shell `PATH` and the same Node as the daemon (a Finder launch has no
shell environment; Node 24 or newer is required, `BIGNOSE_NODE` overrides). Their output goes to
`<BIGNOSE_HOME>/logs/erp.log`.

**The ERP folder** is, in order:

1. `erpDir` in `<BIGNOSE_HOME>/os.json` (`{ "erpDir": "/path/to/boombignose-erp-harness-ai" }`),
2. the `BIGNOSE_OS_ERP_DIR` environment variable,
3. the repo this app was built from (`bignose/desktop/src-tauri/../../..`, fixed at compile time).

The third is a build-time path: an app built in a git worktree keeps pointing at that worktree, so set `erpDir` when
the worktree goes away. `serve` builds the **committed** `HEAD` of that folder, so uncommitted ERP changes are not shown.

**Cloud model keys** are not given to the ERP server. `serve` builds the `next start` environment from a local
allowlist. That allowlist forwards `OLLAMA_HOST` only when it is loopback, and it forwards `OLLAMA_MODEL`.
The desktop product does not call a cloud model at runtime.

When everything answers, the ERP opens at `http://127.0.0.1:3100` (the port is fixed: it is the ERP's `site_url`).
The ERP is a normal first-party page, so Supabase login cookies work. Links to other sites open in the default browser
instead of replacing the ERP. Links that open a new window (`target="_blank"`: the quote and invoice PDF, the print
views) open in their own BoomBigNose window and share the ERP's session, so they work while you are signed in; a new
window for any other web address goes to the browser, and non-web addresses are refused.

### When something is wrong

| Screen | Meaning | What to do |
| --- | --- | --- |
| Docker is not running | the local database runs in Docker | **Open Docker** (`open -a Docker`), wait until it is running, then **Retry** |
| Docker is not installed | no Docker found | install Docker Desktop, then **Retry** |
| ERP folder not found | `scripts/local/stack.mjs` is missing in the folder shown | set `erpDir` in `os.json` or `BIGNOSE_OS_ERP_DIR`, then **Retry** |
| macOS is blocking access to the ERP folder | `EPERM`: macOS folder privacy (the repo is under `~/Desktop`) | System Settings > Privacy & Security > Files & Folders (or Full Disk Access): allow BoomBigNose, then **Retry** |
| The local database did not start | `stack.mjs up` failed; the last lines of its output are shown | read them; a failed migration needs the owner (the app never resets the database) |
| The ERP server did not start / stopped | `stack.mjs serve` exited; the last lines are shown (a busy port 3100 is reported here) | fix the cause, then **Retry** |

## The ERP assistant

On every start the panel makes sure, through the local API only, that these exist (it writes only what is missing):

- the MCP connector **`erp`**: stdio, `command` = the absolute Node, `args` = `[<erp>/lib/mcp/erp-server.mjs]`,
  enabled (the 8 read-only tools in `docs/desktop/erp-mcp.md` of the ERP);
- the agent **ERP assistant**: provider `ollama`, model `qwen3:4b`, connector `erp`, read-only
  instructions. Its permissions are an allow-list: `*` is denied and only `mcp__erp__*` is allowed (so a read is not an
  approval card). That keeps it off every built-in and core tool: `shell`, `read_file`, `list_files`, `search_files`,
  `write_file`, `edit_file`, `web_fetch`, `delegate`, memory, session search, skills and schedules are also denied by name,
  because an exact name in your global permissions would otherwise beat `*`. ERP text can carry a prompt injection, and
  `web_fetch` would let it send data out. `desktop/test/os/erp-setup.test.ts` checks every core tool name against core's own `effectivePolicy`.

Other agents, the active model and all other settings are left as they are. An existing
agent named ERP assistant is never changed, so a model you picked for it stays. If the ERP folder or Node moves, the
`erp` connector is replaced with the new command; a connector you disabled is enabled again.

A new ERP assistant is created with `maxTokens` 4096 so one reply cannot fill the whole local context.

**Privacy (PDPA).** Answers about ERP data stay on the local Ollama process. The tools are read-only and leave out contact details, notes, tax ids and bank references (see the ERP's
`docs/desktop/erp-mcp.md`), but client names can be natural persons.

## Lifecycle

- **Close** (the red button, `Cmd+W`) only hides the window. The daemon, the ERP server, LINE and schedules keep running.
- **Dock click** brings the window back.
- **Quit** (`Cmd+Q`, the BoomBigNose > Quit item, or Quit in the Dock menu) stops every child this run started: the ERP
  launcher with the Next server under it, then the daemon, each with SIGTERM and SIGKILL after a few seconds. A daemon the
  app only attached to (one already running) is left running.
- **The Supabase stack keeps running** after a quit. It is shared with other work on the machine; stop it yourself with
  `pnpm local:stop` in the ERP folder (data is kept).
- If the app is killed instead of quit, the ERP server stops by itself within a second (`serve` watches its parent);
  a daemon it started does not.

## Permissions

`src-tauri/capabilities/panel.json` grants the IPC commands only to the webview labeled `panel` (the BigNose UI, local
app content). The ERP webview (`erp`) is not named by any capability, has no `remote` capability, and is not local
content, so it gets no IPC: a page served by the ERP cannot call the app, the daemon token or the filesystem.
`desktop/test/os/capabilities.test.ts` guards this.

## Checks

- Rust (`cargo test`, after `pnpm --filter desktop build`): lifecycle decisions, panel layout and toggle, the ERP URL, the
  `.env` key reader, folder resolution and its error messages, the View menu shortcut, and the launcher against a fake
  `stack.mjs`.
- `desktop/test/os/`: the Docker-stopped screen, provisioning, capabilities.
- `pnpm --filter desktop e2e`: `e2e/os-layout.e2e.ts` loads the built UI in Chrome (CDP) and checks that settings scroll
  inside the window, that the panel fits 420 px on every screen, and the toggle.
- `node desktop/scripts/os-smoke.mjs` (from `bignose/`): the one Docker smoke. It runs `stack.mjs up` (non-destructive),
  serves the ERP from a temp cache dir on a free port and requests `/login`, starts a daemon with a temp `BIGNOSE_HOME`
  and a free API port and lists the 8 ERP tools through `GET /api/mcp/erp/tools`, then calls `list_workspaces` on the MCP
  server against the local stack. It stops what it started and leaves the stack running. It needs Docker, and a network
  for the first ERP build (fonts). It never uses port 3100 or `~/.bignose`.

## Known limits

- Remembered notes (memory) are still part of every chat's prompt, the ERP assistant's included; the assistant has no
  tool to read or write them.
- The panel does not watch the ERP server after it is ready; if the server dies, use the window's menu to relaunch
  BoomBigNose (the launcher's status is also available to the UI through the `os_status` command).
- Opening Docker is manual: **Open Docker** starts it, then **Retry** re-checks.
- The slide animation, hide-on-close, Dock reopen and quit are native window behavior; they are covered by pure decision
  tests, not by an automated window test.
