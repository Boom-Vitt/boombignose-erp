# Goals

Updated 2026-10-27. No secrets.

## GOAL 1 — Download page

Status: done.

Canonical page: https://boom-vitt.github.io/boombignose-erp-harness-ai/

The previous address https://boom-vitt.github.io/boombignose-erp/ is retired. It returned HTTP 404 after Pages run 40500045933 and again after Pages run 40502514277.

Pages run 40502514277 deployed the v0.2.0 download page. https://boom-vitt.github.io/boombignose-erp-harness-ai/ returned HTTP 200 with the title BoomBigNose ERP Harness AI. `assets/favicon.svg`, `assets/logo.svg`, and `assets/og.png` returned HTTP 200. The buttons link to `BoomBigNose-windows-x64-setup.exe`, `BoomBigNose-macos-arm64.dmg`, `BoomBigNose-linux-amd64.tar.gz`, and `BoomBigNose-linux-amd64.AppImage` on tag `boombignose-v0.2.0`. The page includes the four SHA-256 values that matched `sha256sum -c`. It does not claim a click-test on a physical machine.

## GOAL 2 — Desktop app

Status: in progress.

`boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It refuses cloud keys, including a remote `OLLAMA_HOST`. If `bundle/node` and `bundle/erp/server.js` are next to the executable (or under `BOOMBIGNOSE_BUNDLE`), it starts that bundled Node without Docker and without `node` on `PATH`. Otherwise, if `127.0.0.1:3100` is closed and a checkout is found, it runs `node scripts/local/stack.mjs serve --port 3100`, then opens that URL. Optional Ollama: when a local `ollama` binary exists and `127.0.0.1:11434` is closed, the window runs `ollama serve`. It does not run `ollama pull`. The documented pull is `ollama pull qwen3:4b`. SQLite is not a database for this ERP. A portable `bundle/postgres/bin/postgres` is recognized and is not started. See `docs/boombignose/BUNDLE.md`.

Release https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/tag/boombignose-v0.2.0 is still the latest stable release. Its files are the unsigned window installers, not a bundled stack. No newer release was cut: the release workflow would rebuild the same window, and the Node, Postgres, and Ollama binaries are not in CI yet. Tag `boombignose-v0.1.1` remains the older harness command. A human still has to click Open Anyway and Run anyway on a real machine. This environment has not click-tested the window or the bundle fixture on a physical machine. `go test` did start a local fixture process that listened on `127.0.0.1`.

## GOAL 3 — Remaining phases and rename

Status: in progress.

- Phases 1–10 are recorded in `docs/boombignose/PHASES.md`. Cutover still only prints a plan.
- The GitHub repository is https://github.com/Boom-Vitt/boombignose-erp-harness-ai . The local Supabase `project_id` stays `boombignose-erp`.
- Release `boombignose-v0.1.1` has the older harness-command installers. Tag `bumik-v0.1.0` was deleted.
- `lib/local/stack.mjs` no longer copies `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` into `next start`.
- TOTP enroll and verify are on in `supabase/config.toml`. The screen at `/settings/security` stays closed unless `LOCAL_TOTP_ENROLL=1`. `sessionNeedsStepUp` is tested and is not applied by the proxy or by RLS, so an `aal1` session is not locked. Phone MFA stays off. See `docs/boombignose/TOTP.md`.
- Milestone 2 is not shipped. The launcher can use a portable Node and `server.js` when those files are present. The download still does not contain Postgres, the Next.js server, or Ollama.

## Blockers

- Aikido MCP is not signed in, so the security scan of new code has not run.
- No display session here to click through the unsigned-app dialogs or to open the Wails window against a running ERP.
