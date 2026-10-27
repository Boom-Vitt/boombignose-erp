# TOTP and AAL2

Checked 2026-10-27.

## What is on

`supabase/config.toml` has `[auth.mfa.totp]` with `enroll_enabled = true` and `verify_enabled = true`. Phone MFA stays off. A search of `supabase/migrations` found no policy that reads `aal` or requires a second factor before a row is read or written.

The enrollment screen is `app/(app)/settings/security`. It renders the setup form only when `LOCAL_TOTP_ENROLL=1`. Any other value, including an unset variable, leaves that form closed. `lib/local/stack.mjs` and the portable bundle copy that variable only when the value is exactly `1`. With the flag off, the page does not call GoTrue to enroll a factor.

`lib/auth/totp.ts` exports `sessionNeedsStepUp`. The enrollment flag is not an input. The function is true only when the account has a verified TOTP factor and the current level is not `aal2`. An account with no verified factor stays on one step.

`aal2Rollout` names the four states an operator can be in:

| State | When | What the account sees |
| --- | --- | --- |
| `one-step` | No verified factor, and `LOCAL_TOTP_ENROLL` is not exactly `1` | Password sign-in only. The security screen says enrollment is off. |
| `enroll` | No verified factor, and `LOCAL_TOTP_ENROLL=1` | The security screen shows the setup form. The account stays on one step until a factor is verified. |
| `challenge` | A verified factor exists and the session is not `aal2` | `/login/mfa`, including when the enrollment flag is off. |
| `aal2` | A verified factor exists and the session is `aal2` | The app. Turning the flag off does not remove the factor and does not ask accounts that never enrolled. |

A lookup failure in `requireOrgContext` and on the security screen does not invent a factor. Those sessions stay on `one-step` or `enroll` from the flag alone.

That decision is applied in two places:

- After a successful password sign-in, the login page sends an enrolled account to `/login/mfa`.
- `requireOrgContext` does the same check before an app page loads. The app layout calls it, so enrolled `aal1` sessions are sent to the code page. A lookup failure does not lock the session.

The proxy does not call GoTrue on each request to decide this. `/api/health` returns before a Supabase client is created. `/login/mfa` does not call `requireOrgContext`.

## What is still off

There is no RLS policy that rejects `aal1`. Routes that never call `requireOrgContext` are not stepped up. The service-role key stays out of the desktop binary. The screen was not exercised against a live GoTrue in this run.

A stack that was already running does not see a config change until it is restarted. This note does not restart one.
