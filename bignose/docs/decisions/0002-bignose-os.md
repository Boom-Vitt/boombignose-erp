# 0002 — BigNose OS: the ERP in one window with a BigNose panel

Status: accepted (2026-10-15). Builds on `0001-architecture.md`. Operator guide: `docs/bignose-os.md`.

## Context

The owner wants one native app: the BoomBigNose ERP (Next.js + local Supabase, `docs/desktop/local-stack.md` in the
ERP) with BigNose's agent UI beside it, able to answer questions about ERP data through the read-only ERP MCP server.
The BigNose app already starts and attaches to the daemon (`sidecar.rs`) and the ERP can be served on loopback by
`scripts/local/stack.mjs`. The old app also had two lifecycle faults (shell-01: the window close ended the app's
children while LINE and schedules should keep running) and a layout fault (settings-ui-1: the shell grew past the
window, so Save was unreachable).

## Decision

- **One window, two multiwebview children.** `tauri` gets its `unstable` feature (Tauri's multiwebview API,
  `Window::add_child`); no new crate and no new npm package. The window is created in code, not from a config webview.
  The **ERP** is a top-level webview on `http://127.0.0.1:3100`, so its cookies are first party and Supabase login works
  (an iframe in the BigNose page would be third-party and blocked). The **BigNose UI** (the existing `desktop/src`,
  same build) is the second webview, docked on the right.
- **The ERP gets no IPC.** The only capability names the `panel` webview. The ERP webview is a remote origin with no
  `remote` capability, so Tauri denies every command to it. A capability by window label would have covered both
  webviews, so it is by webview label, and a test enforces that.
- **The panel is the same page in two modes.** The window injects `window.__BIGNOSE_OS__`; the page then waits for the
  launcher, provisions the ERP assistant and shows a compact layout. Without the flag the page behaves as before
  (existing e2e tests unchanged). Closed, the panel is a 40 px rail (not zero), so the toggle button stays visible.
- **The launcher runs `node <erp>/scripts/local/stack.mjs doctor|up|serve` as managed children** in their own process
  group, with the login-shell `PATH` and the daemon's Node. The ERP folder is `erpDir` in `os.json`, else
  `BIGNOSE_OS_ERP_DIR`, else the compile-time repo root. Docker stopped, a missing folder and `EPERM` (macOS folder
  privacy on `~/Desktop`) are their own screens. The OpenRouter key goes from `<BIGNOSE_HOME>/.env` into the child's
  environment only.
- **Lifecycle decisions are pure functions** (`lifecycle.rs`): close hides, an unrequested exit is refused, a Dock
  click shows the window, and quit stops only the children this run started (launcher group, then daemon). The
  Supabase stack is not ours to stop: it is shared, so it keeps running.
- **Provisioning goes through the local API** (`POST /api/mcp`, `GET/POST /api/agents`), is idempotent, and never
  changes other agents, the active model or other settings. The ERP assistant's permissions are an allow-list
  (`*` denied, `mcp__erp__*` allowed) plus every core tool denied by name: ERP records are untrusted text, `web_fetch` is
  an exfiltration route, and `read_file`, `list_files` and `search_files` would let an injection read local files such as
  an `.env.local` and send them to the cloud model. The names are repeated because an exact name in the owner's global
  permissions beats the agent's `*`. `mcp__erp__*` is allowed so read-only lookups do not each ask for approval.
- **Links leaving the ERP open in the default browser** instead of replacing the ERP in the window. A new window
  (`target="_blank"`) to an ERP page is allowed, so PDFs and print views open in their own window with the same cookies;
  a new window to another web address goes to the browser; anything else is refused.

## Consequences

- The app depends on the ERP repo's `stack.mjs` and `erp-server.mjs` contracts (doctor JSON, exit code 3 for Docker,
  the `ready http://127.0.0.1:<port>` line, parent-death watch).
- A built app points at the repo it was built from unless `erpDir` is set; the first start after a new ERP commit
  builds it and needs a network.
- Port 3100 is fixed (the ERP's `site_url`); a busy port is a startup failure, not a fallback.
- Multiwebview is behind Tauri's `unstable` feature, so a Tauri upgrade may need changes in `shell.rs`. If a child
  webview ever proves unworkable, the fallback is a borderless child window that tracks the main window.
- ERP data read by the assistant goes to the model provider (PDPA); the read-only column whitelists of the MCP server
  are the guard, and the owner decides which provider and model the assistant uses.
