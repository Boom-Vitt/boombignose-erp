# TOTP and AAL2

Checked 2026-10-27.

## What is on

`supabase/config.toml` has `[auth.mfa.totp]` with `enroll_enabled = true` and `verify_enabled = true`. Phone MFA stays off. A search of `supabase/migrations` found no policy that reads `aal` or requires a second factor before a row is read or written.

The enrollment screen is `app/(app)/settings/security`. It renders the setup form only when `LOCAL_TOTP_ENROLL=1`. Any other value, including an unset variable, leaves that form closed. `lib/local/stack.mjs` and the portable bundle copy that variable only when the value is exactly `1`. With the flag off, the page does not call GoTrue to enroll a factor.

`lib/auth/totp.ts` exports `sessionNeedsStepUp`. The enrollment flag is not an input. The function is true only when the account has a verified TOTP factor and the current level is not `aal2`. An account with no verified factor stays on one step.

That decision is applied in two places:

- After a successful password sign-in, the login page sends an enrolled account to `/login/mfa`.
- `requireOrgContext` does the same check before an app page loads. The app layout calls it, so enrolled `aal1` sessions are sent to the code page. A lookup failure does not lock the session.

The proxy does not call GoTrue on each request to decide this. `/api/health` returns before a Supabase client is created. `/login/mfa` does not call `requireOrgContext`.

## What is still off

There is no RLS policy that rejects `aal1`. Routes that never call `requireOrgContext` are not stepped up. The service-role key stays out of the desktop binary. The screen was not exercised against a live GoTrue in this run.

A stack that was already running does not see a config change until it is restarted. This note does not restart one.
