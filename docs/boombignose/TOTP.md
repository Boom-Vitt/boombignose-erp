# TOTP and AAL2

Checked 2026-10-27.

## What is on

`supabase/config.toml` has `[auth.mfa.totp]` with `enroll_enabled = true` and `verify_enabled = true`. Phone MFA stays off. A search of `supabase/migrations` found no policy that reads `aal` or requires a second factor before a row is read or written.

The enrollment screen is `app/(app)/settings/security`. It renders the setup form only when `LOCAL_TOTP_ENROLL=1`. `lib/local/stack.mjs` copies that variable into `next start` only when the value is exactly `1`. Any other value leaves the screen closed. With the flag off, the page does not call GoTrue.

`lib/auth/totp.ts` exports `sessionNeedsStepUp`. It is true only when the flag is on, the account has a verified TOTP factor, and the session is not `aal2`. The proxy and the database do not call it, so an `aal1` session still opens the rest of the ERP. The screen tells the signed-in user that the next sign-in can ask for a code and that other pages stay open.

A stack that was already running does not see the config change until it is restarted. This note does not restart one.

## What is still off

There is no RLS policy that rejects `aal1`. The service-role key stays out of the desktop binary. The screen was not exercised against a live GoTrue in this run.
