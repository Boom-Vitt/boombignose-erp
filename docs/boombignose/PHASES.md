# Phase status for BoomBigNose

Work is in this repository. Nothing here reads or writes a live database.

| Phase | Status |
|---|---|
| 1 Inventory | Recorded before this work. The October Rust inventory is parked and is not the current count. |
| Landing | `site/index.html` on `main`. Pages deploys from `main`. Download links point at `BoomBigNose-macos-arm64.dmg`, `BoomBigNose-windows-x64-setup.exe`, and `BoomBigNose-linux-amd64.tar.gz` on tag `boombignose-v0.1.1`. Those files are the harness command, not a windowed ERP. |
| 2 Go scaffold | `boombignose/` module. `go test ./...` covers it. |
| 3 Domain | Not ported. Money formatting is integer satang only. Postgres functions remain the finance and stock rules. |
| 4 GUI | Milestone 1 is a Wails webview of `http://127.0.0.1:3100` after `boombignose check`. The window is not compiled in this tree. |
| 5 Auth | Loopback Supabase URL only. `supabase/config.toml` contains `[auth.mfa.totp]` with enrollment and verify turned off. No migration here requires a second factor. The shell does not add or remove that block. |
| 6 Automation | Non-loopback `N8N_OUTBOUND_URL` and `RESEND_API_KEY` are refused. Cron code in the Next app is unchanged. |
| 7 Packaging | `.github/workflows/boombignose-release.yml` builds an unsigned NSIS installer, an ad-hoc-signed macOS DMG, a Linux tarball, and SHA256SUMS. |
| 8 Pages | Same as the landing row. |
| 9 Tests | Harness unit tests run locally and in the release workflow. The ERP Vitest, SQL, and Playwright suites are unchanged and were not re-run for this shell. |
| 10 Cutover | `boombignose cutover` and `docs/boombignose/CUTOVER.md`. The command refuses to connect to a database. |

A cloud VM cannot click through SmartScreen or the macOS Open Anyway dialog, and it cannot compile the Wails window without that SDK on each OS.
