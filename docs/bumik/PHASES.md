# Phase status for Bumik Node ERP harness AI

Work is in this repository. Nothing here reads or writes a live database.

| Phase | Status |
|---|---|
| 1 Inventory | Recorded before this work. The October Rust inventory is parked and is not the current count. |
| Landing | `site/index.html` on `main`. Pages deploys from `main`. Download buttons stay “coming soon” until a windowed build exists. |
| 2 Go scaffold | `bumik/` module. `go test ./...` covers it. |
| 3 Domain | Not ported. Money formatting is integer satang only. Postgres functions remain the finance and stock rules. |
| 4 GUI | Milestone 1 is a Wails webview of `http://127.0.0.1:3100` after `bumik check`. The window is not compiled in this tree. |
| 5 Auth | Loopback Supabase URL only. `supabase/config.toml` contains `[auth.mfa.totp]` with enrollment and verify turned off. No migration here requires a second factor. The shell does not add or remove that block. |
| 6 Automation | Non-loopback `N8N_OUTBOUND_URL` and `RESEND_API_KEY` are refused. Cron code in the Next app is unchanged. |
| 7 Packaging | `.github/workflows/bumik-release.yml` builds an unsigned NSIS installer and an ad-hoc-signed macOS DMG, plus SHA256SUMS. Linux does not block that pair. |
| 8 Pages | Same as the landing row. |
| 9 Tests | Harness unit tests run locally and in the release workflow. The ERP Vitest, SQL, and Playwright suites are unchanged and were not re-run for this shell. |
| 10 Cutover | `bumik cutover` and `docs/bumik/CUTOVER.md`. The command refuses to connect to a database. |

A cloud VM cannot click through SmartScreen or the macOS Open Anyway dialog, and it cannot compile the Wails window without that SDK on each OS.
