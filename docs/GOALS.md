# Goals

Updated 2026-10-27. No secrets.

## GOAL 1 — Download page

Status: done.

Canonical page: https://boom-vitt.github.io/boombignose-erp-harness-ai/

The previous address https://boom-vitt.github.io/boombignose-erp/ is retired. It returned HTTP 404 after Pages run 40500045933 and again after Pages run 40502514277.

Pages run 40502514277 deployed the v0.2.0 download page. https://boom-vitt.github.io/boombignose-erp-harness-ai/ returned HTTP 200 with the title BoomBigNose ERP Harness AI. `assets/favicon.svg`, `assets/logo.svg`, and `assets/og.png` returned HTTP 200. The buttons link to `BoomBigNose-windows-x64-setup.exe`, `BoomBigNose-macos-arm64.dmg`, `BoomBigNose-linux-amd64.tar.gz`, and `BoomBigNose-linux-amd64.AppImage` on tag `boombignose-v0.2.0`. The page includes the four SHA-256 values that matched `sha256sum -c`. It does not claim a click-test on a physical machine.

## GOAL 2 — Desktop app

Status: in progress.

`boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It refuses cloud keys, including a remote `OLLAMA_HOST`. If `127.0.0.1:3100` is closed and a checkout is found (`BOOMBIGNOSE_ERP_DIR`, the working directory, or the executable directory), it runs `node scripts/local/stack.mjs serve --port 3100`, then opens that URL. Release https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/tag/boombignose-v0.2.0 is a stable release, not a prerelease. Its CI publish job uploaded the unsigned Windows NSIS installer, the ad-hoc macOS arm64 DMG, the Linux tar.gz, the Linux AppImage, and SHA256SUMS. `sha256sum -c` matched those four files. Tag `boombignose-v0.1.1` remains the older harness command. The window installers do not bundle Node, Docker, Postgres, or Ollama. A human still has to click Open Anyway and Run anyway on a real machine. This environment has not click-tested them.

## GOAL 3 — Remaining phases and rename

Status: in progress.

- Phases 1–10 are recorded in `docs/boombignose/PHASES.md`. Cutover still only prints a plan.
- The GitHub repository is https://github.com/Boom-Vitt/boombignose-erp-harness-ai . The local Supabase `project_id` stays `boombignose-erp`.
- Release `boombignose-v0.1.1` has the older harness-command installers. Tag `bumik-v0.1.0` was deleted.
- `lib/local/stack.mjs` no longer copies `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` into `next start`.
- TOTP stays off. `docs/boombignose/TOTP.md` is the proposal. No AAL2 migration was added, because a blanket `aal1` refusal would lock local sign-in before an enrollment screen exists.
- Milestone 2 (a download that bundles Postgres, auth, the API, Next.js, and Ollama) is not shipped. The window can start a checkout that is already on the machine.

## Blockers

- Aikido MCP is not signed in, so the security scan of new code has not run.
- No display session here to click through the unsigned-app dialogs or to open the Wails window against a running ERP.
