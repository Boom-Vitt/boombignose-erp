# E2E stability handover: the proxy exhausted the local auth service

Branch `odoo-e2e-stable`, fast-forwarded to `odoo-parity` at `87851f8` (which contains `be011d0` and `5a065cd`). Commits are local and nothing was pushed.

## What was broken

Late specs failed only in full runs. `vat-wht` failed in every full run on `c5348bc` and `web-to-lead` in about half. Each failure landed at a different step: the lock date stayed null after Save, the "Finance period is locked" toast never showed, the Disable button was missing, a 30 s timeout, `admin.deleteUser` failed, or a demo login stayed on `/login`. Run alone on a fresh database, both specs passed in 3 s.

## Root cause

Every request through `proxy.ts` called `supabase.auth.getUser()`, which is a network call to GoTrue `/user`. In production builds, Next prefetches every sidebar and header link, so one page view sends 39 to 52 RSC prefetches through the proxy. A probe spec counted 41, 44 and 55 `/user` calls for one view of `/dashboard`, `/settings/finance` and `/deals`.

The local GoTrue (`gotrue:v2.197.0`) opens about 10 new Postgres connections per `/user` call, whether the calls are sequential or parallel: 50 calls left 492 and 497 sockets in TIME_WAIT. TIME_WAIT lasts 60 s and the container's ephemeral port range is 32768 to 60999 (28,231 ports), so the stack can sustain about 2,800 `/user` calls a minute. The suite reached about 2,800 a minute during the dense `v2`/`v3` specs. The specs that run right after them then hit `dial tcp ...:5432: connect: cannot assign requested address`, and GoTrue answered 500.

The app treats a failed `getUser()` as signed out, so each 500 became a different symptom. The proxy redirected page loads, prefetches and server-action POSTs to `/login`. The login action and the admin API failed outright. That explains why the failing step moved from run to run.

Evidence:

- Per-second socket sampling inside `supabase_auth_<project>` showed peak TIME_WAIT to `:5432` of 25,949 in one run and 28,231 (the whole range) in another.
- An instrumented build logged 72 `PROBE proxy getUser 500` lines in one run. They started right after `v3.spec.ts` and included `POST /finance/invoices/<id>`, which is the Issue server action.
- The auth 500s matched the failures in all four uninstrumented runs. Runs with 71 and 80 auth 500s failed. Runs with 0 passed, including a traced run that was slower and therefore made fewer calls per second.

## Fix

`lib/supabase/middleware.ts` now calls `supabase.auth.getClaims()` instead of `getUser()`. This is the pattern Supabase documents for middleware. For the ES256 tokens this stack issues, `getClaims` verifies the signature against the JWKS, which auth-js caches globally for 10 minutes, so the proxy no longer calls the auth server. It still loads and refreshes the session cookie the same way. HS256 tokens fall back to `getUser()` inside `getClaims`.

Security does not change. The proxy only uses the result to decide whether to redirect. Pages and server actions still resolve the user with `getUser()` through `requireOrgContext`. PostgREST and RLS already accept the same JWT on signature and expiry alone.

After the fix the same probe counted 1, 1 and 2 `/user` calls per page view. Peak TIME_WAIT in full runs fell to about 4,930, and the full suite now takes about 50 s instead of 1.2 to 1.7 min.

## Hypotheses ruled out

- **Auth rate limit.** I found no 429 in the auth logs across 6 full runs, each with about 54 logins. The CLI does not pass a sign-in limit to the container (`GOTRUE_RATE_LIMIT_SIGN_IN*` is unset), and every auth error was the Postgres-connect 500. Raising `sign_in_sign_ups` or reusing `storageState` would not have helped, because logins were about 2% of the auth traffic.
- **Leaked rows, settings or counters.** `vat-wht` already creates its own org and user. Its failures happened inside GoTrue (session lookups, `deleteUser`), not in its data.

## Files

- `lib/supabase/middleware.ts` replaces `getUser()` with `getClaims()` in `updateSession`.
- `lib/supabase/proxy-session.test.ts` is new. It runs the real `@supabase/ssr` client with an ES256 session cookie signed through WebCrypto and a stubbed `fetch`. It checks that a validly signed session reaches `/deals` with no `/auth/v1/user` request, and that a session signed by another key goes to `/login?redirect=%2Fdeals`. Commit `d9e6644` adds it failing, before the fix in `0ca42fd`.
- `lib/supabase/auth-routing.test.ts`, `lib/supabase/blueprint-preview.test.ts` and `lib/lead-forms/middleware.test.ts` now mock `getClaims` instead of `getUser`.

No spec under `e2e/` needed a change.

## SQL function ownership

Created: none. Replaced: none. This track has no migration.

## How it was verified

There were three consecutive `pnpm e2e` runs on the 561xx stack, each after `.local-stack/db-reset.sh` (SQL tests 717/717 at reset):

```
proof1:  4 skipped  46 passed (48.6s)   auth 5xx 0   peak TIME_WAIT 4904
proof2:  4 skipped  46 passed (52.3s)   auth 5xx 0   peak TIME_WAIT 4932
proof3:  4 skipped  46 passed (54.9s)   auth 5xx 0   peak TIME_WAIT 4931
```

Gates:

```
pnpm lint       $ eslint              (exit 0)
pnpm typecheck  $ tsc --noEmit        (exit 0)
pnpm test       Test Files  149 passed (149)   Tests  1177 passed (1177)
pnpm build      ✓ Generating static pages using 17 workers (23/23) in 243ms   (exit 0)
```

## Open issues

- **Pre-hydration input is lost in controlled forms.** I saw no evidence of this at normal speed. With an 8x Chrome CPU throttle (`Emulation.setCPUThrottlingRate`), `vat-wht` alone failed 3 of 3: Playwright filled "Lock transactions through" before React hydrated it (`__reactProps` absent), so `FinanceLockForm` submitted its stale state. At 1x and 4x it passed every time. A heavily loaded machine could hit it. A fix would wait for hydration before interacting, in the specs or in the app. Real users who type before hydration hit the same behaviour.
- **The app reads an auth outage as a logout.** `getOrgContext` and the proxy both turn an auth-server error into "signed out" and redirect to `/login`. That made this outage look like random logouts. Throwing to the error boundary on a 5xx would surface it correctly.
- **The local GoTrue does not reuse database connections.** It opens about 10 Postgres connections per request. `supabase/config.toml` does not expose a setting for that pool, so heavy local traffic can still exhaust ports. About 45 requests a second over a minute would do it, roughly 20 times the suite's new peak.
- **A server log error in one spec.** In one run, `tenant-onboarding.spec.ts` "a committed subscription request ..." logged `Unable to load activity assignees` from a server render, without failing. It is probably a render still running while the spec deletes its org in `finally`. I did not investigate further.
