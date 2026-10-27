# Goals

Updated 2026-10-27. No secrets.

## GOAL 1 — Download page

Status: done.

Canonical page: https://boom-vitt.github.io/boombignose-erp-harness-ai/

The previous address https://boom-vitt.github.io/boombignose-erp/ is retired and does not receive new deploys. On 2026-10-27, before this rename deploy, both addresses still returned the same HTML (HTTP 200, title BoomBigNose ERP Harness AI). Recheck both addresses after the next Pages run.

The page links the `boombignose-v0.1.1` harness-command installers until a green CI release of the window exists. It does not claim those files were click-tested.

## GOAL 2 — Desktop app

Status: in progress.

`boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It refuses cloud keys, including a remote `OLLAMA_HOST`. If `127.0.0.1:3100` is closed and a checkout is found (`BOOMBIGNOSE_ERP_DIR`, the working directory, or the executable directory), it runs `node scripts/local/stack.mjs serve --port 3100`, then opens that URL. `.github/workflows/boombignose-release.yml` packages that window as an unsigned Windows NSIS installer, an ad-hoc-signed macOS arm64 DMG, a Linux tar.gz, and a Linux AppImage, plus SHA256SUMS. Those assets are published only for a `boombignose-v*` release. Tag `boombignose-v0.1.1` is still the harness command. The window installers do not bundle Node, Docker, Postgres, or Ollama. A human still has to click Open Anyway and Run anyway on a real machine. This environment has not click-tested them.

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
