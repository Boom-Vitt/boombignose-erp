# BoomBigNose — local architecture

Product name: **BoomBigNose**. The desktop product stays fully local at runtime: data and rules on the machine, and no cloud model call.

## Milestones

**Milestone 1.** A Go shell opens the existing ERP in a webview at `http://127.0.0.1:3100`. Before the window loads, `boombignose check` refuses cloud credentials (`OPENROUTER_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`) and refuses any Supabase, n8n, or ERP URL that is not loopback. The webview is the same shape as BigNose OS (Tauri): first-party cookies on loopback, no IPC into the ERP page. Wails is the GUI toolkit for that window. This repository contains the gate and the URL rule. It does not yet compile a Wails window, because that build needs the OS webview SDK.

**Milestone 2.** Ship a bundled local stack so the download does not ask the operator to install Node, pnpm, and Docker by hand. That bundle is not in this tree. Milestone 1 still uses the existing local Supabase stack on loopback. Hosted Supabase (`*.supabase.co`) is refused.

BigNose OS stays beside this app. Both use port 3100, so only one may listen. See `docs/boombignose/CUTOVER.md`.

## What stays where it is

Business writes stay in the Postgres functions already shipped with the ERP. The Go module does not reimplement them. `boombignose/internal/money` only formats an integer satang amount. The Next.js UI stays the screen inside the webview.

## Auth

Sign-in stays the ERP's Supabase email and password session, stored in cookies for `127.0.0.1`.

`supabase/config.toml` has an `[auth.mfa]` block and an `[auth.mfa.totp]` block, so TOTP is part of the auth surface in this repo. In the committed file both `enroll_enabled` and `verify_enabled` are `false` for TOTP and for phone. A search of `supabase/migrations` found no policy, trigger, or function that requires a second factor (AAL2) before a row is read or written. This note does not turn those flags on and does not add a database rule. The shell must not bypass a later second-factor rule with a service-role key. The service-role key stays out of the desktop binary.

## Cloud calls the gate refuses

- `lib/ai/client.ts` posts to `https://openrouter.ai` when `OPENROUTER_API_KEY` is set. The harness refuses that variable.
- `lib/email/send.ts` posts to Resend when `RESEND_API_KEY` is set. The harness refuses that variable.
- `app/api/cron/outbox/route.ts` posts to `N8N_OUTBOUND_URL`. The harness allows that URL only when it is loopback or empty.
- `lib/local/stack.mjs` does not copy `OPENROUTER_API_KEY` or `OPENROUTER_MODEL` into `next start`. The ERP process started by `serve` has those variables unset even when the parent environment has them.

## Pages

The site at `site/` is a static brochure. It is not the app and it does not call a model.
