# Goals

Updated 2026-10-27. No secrets.

## GOAL 1 — Download page

Status: in progress.

The page was redesigned with our own mark, Midnight Local colors, and honest links to the boombignose-v0.1.1 installers. Live HTTP 200 on https://boom-vitt.github.io/boombignose-erp/ is checked after this change is on `main`.

## GOAL 2 — Desktop app

Status: in progress.

`boombignose/cmd/boombignose-desktop` is a Wails window. It refuses cloud keys, then navigates to http://127.0.0.1:3100. The window title string is BoomBigNose ERP Harness AI. CI has compiled Linux, Windows (GUI subsystem), and macOS arm64 binaries. Those raw binaries are on the prerelease tag `boombignose-desktop-v0.1.2`. Release run 40490194972 had uploaded harness installers onto that tag and replaced `SHA256SUMS`. Those three installer copies were removed, and `SHA256SUMS` again matches only the three desktop binaries. They are not yet the NSIS, DMG, and tar.gz installers of that window, and there is no AppImage. The landing-page files on `boombignose-v0.1.1` are the harness command. Milestone 2 (bundled Postgres, auth, API, Next.js, and Ollama) is not started. A human still has to click Open Anyway and Run anyway on a real machine.

## GOAL 3 — Remaining phases and rename

Status: in progress.

- Phases 1–10 are recorded in `docs/boombignose/PHASES.md`. Cutover still only prints a plan.
- Full title BoomBigNose ERP Harness AI is on the download page and the harness docs.
- Repository rename to `boombignose-erp-harness-ai` returned HTTP 403. An admin must run: `gh api -X PATCH repos/Boom-Vitt/boombignose-erp -f name=boombignose-erp-harness-ai`
- Release `boombignose-v0.1.1` has the BoomBigNose installer names from CI. Tag `bumik-v0.1.0` was deleted.
- `lib/local/stack.mjs` no longer copies `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` into `next start`.
- TOTP: `supabase/config.toml` has `[auth.mfa.totp]` with `enroll_enabled` and `verify_enabled` false. No migration requiring AAL2 was found.

## Blockers

- Repo administration for the rename (HTTP 403).
- Aikido MCP is not signed in, so the security scan of new code has not run.
- No display session here to click through the unsigned-app dialogs or to open the Wails window against a running ERP.
