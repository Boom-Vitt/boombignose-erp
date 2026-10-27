# Goals

Updated 2026-10-27. No secrets.

## GOAL 1 — Download page

Status: done.

Canonical page: https://boom-vitt.github.io/boombignose-erp-harness-ai/

The previous address https://boom-vitt.github.io/boombignose-erp/ is retired. It returned HTTP 404 after Pages run 40500045933 and again after Pages run 40502514277.

Pages run 40502514277 deployed the v0.2.0 download page. https://boom-vitt.github.io/boombignose-erp-harness-ai/ returned HTTP 200 with the title BoomBigNose ERP Harness AI. `assets/favicon.svg`, `assets/logo.svg`, and `assets/og.png` returned HTTP 200. The buttons link to `BoomBigNose-windows-x64-setup.exe`, `BoomBigNose-macos-arm64.dmg`, `BoomBigNose-linux-amd64.tar.gz`, and `BoomBigNose-linux-amd64.AppImage` on tag `boombignose-v0.2.0`. The page includes the four SHA-256 values that matched `sha256sum -c`. Those files were built by GitHub Actions from commit `7cba44c`. Tag `boombignose-v0.1.1` is the older harness command and is not the download target. The page states that the installers are unsigned. They have not been click-tested on a physical machine.

## GOAL 2 — Desktop app

Status: installers are published. Click-through on a physical machine is not done.

`boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It refuses cloud keys, including a remote `OLLAMA_HOST`. If `127.0.0.1:3100` is closed and a checkout is found (`BOOMBIGNOSE_ERP_DIR`, the working directory, or the executable directory), it runs `node scripts/local/stack.mjs serve --port 3100`, then opens that URL. `.github/workflows/boombignose-release.yml` and `.github/workflows/boombignose-desktop.yml` run on push to `main` and on pull requests. The release workflow packages the window as an unsigned Windows NSIS installer, an ad-hoc-signed macOS arm64 DMG, a Linux tar.gz, and a Linux AppImage, plus SHA256SUMS. Assets are uploaded only for a published `boombignose-v*` release. Release https://github.com/Boom-Vitt/boombignose-erp-harness-ai/releases/tag/boombignose-v0.2.0 is a stable release, not a prerelease. `sha256sum -c` matched those four files. Tag `boombignose-v0.1.1` remains the older harness command. The window installers do not bundle Node, Docker, Postgres, or Ollama. There is no paid code-signing certificate. A human still has to click Open Anyway and Run anyway on a real machine. This environment has not click-tested them.

## GOAL 3 — Remaining phases and rename

Status: in progress.

- Phases 1–10 are recorded in `docs/boombignose/PHASES.md`. Cutover still only prints a plan. It does not move database rows.
- The GitHub repository is https://github.com/Boom-Vitt/boombignose-erp-harness-ai . The Go module path is `github.com/Boom-Vitt/boombignose-erp-harness-ai/boombignose`. The local Supabase `project_id` stays `boombignose-erp`.
- Deal summaries, follow-up drafts, and meeting intake call Ollama on loopback. The default address is `127.0.0.1:11434`. A remote host is refused before any request. If Ollama is not running, the screen says AI is not configured.
- The shipped bignose provider list is Ollama only. Cloud model hosts are refused before a request.
- TOTP stays off. `docs/boombignose/TOTP.md` is the proposal. No AAL2 migration was added, because a blanket `aal1` refusal would lock local sign-in before an enrollment screen exists.
- Milestone 2 (a download that bundles Postgres, auth, the API, Next.js, and Ollama) is not shipped. The window can start a checkout that is already on the machine.

## Blockers a human still has to do

- Buy and install an Apple Developer certificate and a Windows Authenticode certificate if the unsigned-app prompts must go away. This work does not buy them.
- Click the unsigned installers on a real Windows, macOS, and Linux machine. This environment has no display session for that.
- Pull a local model (`ollama pull qwen3:4b`) on the machine that runs the ERP if the AI screens should answer.
