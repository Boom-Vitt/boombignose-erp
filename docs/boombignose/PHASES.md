# Phase status for BoomBigNose ERP Harness AI

Work is in this repository. Nothing here reads or writes a live database.

| Phase | Status |
|---|---|
| 1 Inventory | Recorded before this work. The October Rust inventory is parked and is not the current count. |
| Landing | `site/index.html` on `main`. Pages deploys from `main` to https://boom-vitt.github.io/boombignose-erp-harness-ai/ . The previous Pages address is retired. Download links point at the Wails window installers on tag `boombignose-v0.2.0`: `BoomBigNose-macos-arm64.dmg`, `BoomBigNose-windows-x64-setup.exe`, `BoomBigNose-linux-amd64.tar.gz`, plus `BoomBigNose-linux-amd64.AppImage` and `SHA256SUMS`. Tag `boombignose-v0.1.1` remains the older harness command. |
| 2 Go scaffold | `boombignose/` module. `go test ./...` covers it. |
| 3 Domain | Not ported. Money formatting is integer satang only. Postgres functions remain the finance and stock rules. |
| 4 GUI | `boombignose/cmd/boombignose-desktop` is a Wails webview of `http://127.0.0.1:3100` after the local gate. A complete `bundle/node` plus `bundle/erp/server.js` is started without Docker, and portable Postgres is started when its binary is present. Otherwise, if that port is closed and a checkout is found, the window starts `node scripts/local/stack.mjs serve`. `.github/workflows/boombignose-desktop.yml` runs on push to `main` and on pull requests: `go test ./...`, then a compile of the window on Linux, Windows, and macOS. A cloud VM cannot click Open Anyway or Run anyway. |
| 5 Auth | Loopback Supabase URL only. `supabase/config.toml` allows TOTP enroll and verify. The enrollment screen stays closed unless `LOCAL_TOTP_ENROLL=1`. An account with a verified factor is sent to `/login/mfa` until the session is `aal2`. An account with no factor is not. No migration requires a second factor. `docs/boombignose/TOTP.md` records that. |
| 6 Automation | Non-loopback `N8N_OUTBOUND_URL` and `RESEND_API_KEY` are refused. `lib/ai/client.ts` calls loopback Ollama only. `lib/local/stack.mjs` does not forward cloud model keys into `next start`. It forwards a loopback `OLLAMA_HOST`, `OLLAMA_MODEL`, and `LOCAL_TOTP_ENROLL` only when that value is `1`. Cron code in the Next app is unchanged. |
| 7 Packaging | `.github/workflows/boombignose-release.yml` builds an unsigned NSIS installer, an ad-hoc-signed macOS DMG, a Linux tarball, a Linux AppImage, and SHA256SUMS. Each platform job packs pinned Node, a Linux-built standalone `server.js`, and portable Postgres, then smoke-tests `http://127.0.0.1:3100/api/health`. Run [40526064339](https://github.com/Boom-Vitt/boombignose-erp-harness-ai/actions/runs/40526064339) passed that smoke on Linux, Windows, and macOS, and the installer jobs packed `bundle/`. Assets are uploaded only for a published `boombignose-v*` tag. Tag `boombignose-v0.2.0` is still the window-only release. No newer tag was published. |
| 8 Pages | Same as the landing row. |
| 9 Tests | Harness unit tests run locally and in the release workflow. The ERP Vitest, SQL, and Playwright suites are unchanged and were not re-run for this shell. |
| 10 Cutover | `boombignose cutover` and `docs/boombignose/CUTOVER.md`. The command refuses to connect to a database. |

A cloud VM cannot click through SmartScreen or the macOS Open Anyway dialog. The desktop workflow compiles the window on the hosted runners; it does not open that window against a running ERP.
