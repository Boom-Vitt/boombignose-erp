# BoomBigNose ERP Harness AI — local architecture

Product name: **BoomBigNose ERP Harness AI**. The short name on the window title, installer, and asset filenames is **BoomBigNose**. The desktop product stays fully local at runtime: data and rules on the machine, and no cloud model call.

## Milestones

**Milestone 1.** `boombignose/cmd/boombignose-desktop` is a Wails window titled BoomBigNose ERP Harness AI. It is built with `-tags desktop` so the harness command does not link a webview. Before the window is created, it runs the same local gate as `boombignose check`: it refuses `OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `RESEND_API_KEY`, and it refuses a Supabase, n8n, ERP, or `OLLAMA_HOST` value that is not loopback. After the splash page is ready, the window looks for a checkout (`BOOMBIGNOSE_ERP_DIR`, then the working directory and the executable directory). When nothing is listening on the ERP port and a checkout is present, it runs `node scripts/local/stack.mjs serve --port <port>`. It then navigates the top-level webview to `http://127.0.0.1:3100` (or `BOOMBIGNOSE_ERP_URL` when that value is loopback). That navigation keeps first-party cookies on loopback. It is not a reverse proxy. `.github/workflows/boombignose-release.yml` packages that window. The macOS link adds `UniformTypeIdentifiers`, which the Wails WebKit bridge uses for file types.

**Milestone 2.** Ship a bundled local stack so the download does not ask the operator to install Node, pnpm, and Docker by hand. That bundle is not in this tree. The window can start the checkout that is already on the machine. It does not bundle Postgres, Ollama, or the Next.js app. Hosted Supabase (`*.supabase.co`) is refused. An empty `OLLAMA_HOST` is allowed. A remote `OLLAMA_HOST` is refused. See `docs/boombignose/TOTP.md` for the second-factor proposal. The TOTP flags stay off.

The shell in `bignose/` also uses port 3100, so only one program may listen. See `docs/boombignose/CUTOVER.md`.

## What stays where it is

Business writes stay in the Postgres functions already shipped with the ERP. The Go module does not reimplement them. `boombignose/internal/money` only formats an integer satang amount. The Next.js UI stays the screen inside the webview.

## Auth

Sign-in stays the ERP's Supabase email and password session, stored in cookies for `127.0.0.1`.

`supabase/config.toml` has an `[auth.mfa]` block and an `[auth.mfa.totp]` block, so TOTP is part of the auth surface in this repo. In the committed file both `enroll_enabled` and `verify_enabled` are `false` for TOTP and for phone. A search of `supabase/migrations` found no policy, trigger, or function that requires a second factor (AAL2) before a row is read or written. `docs/boombignose/TOTP.md` records why those flags stay off and how a later enrollment screen would require `aal2` only for an account that has a factor. This note does not turn those flags on and does not add a database rule. The shell must not bypass a later second-factor rule with a service-role key. The service-role key stays out of the desktop binary.

## Cloud calls the gate refuses

- `lib/ai/client.ts` posts to Ollama on loopback (`OLLAMA_HOST`, default `127.0.0.1:11434`). A remote host throws before any request. A refused connection becomes a not-configured notice.
- `lib/email/send.ts` posts to Resend when `RESEND_API_KEY` is set. The harness refuses that variable.
- `app/api/cron/outbox/route.ts` posts to `N8N_OUTBOUND_URL`. The harness allows that URL only when it is loopback or empty.
- `lib/local/stack.mjs` does not copy cloud model keys into `next start`. It forwards `OLLAMA_HOST` only when that value is loopback, and it forwards `OLLAMA_MODEL`.

## Pages

The site at `site/` is a static brochure. It is not the app and it does not call a model.
