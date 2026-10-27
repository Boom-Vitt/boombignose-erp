# TOTP and AAL2

Checked 2026-10-27. This note is a proposal. It does not change `supabase/config.toml` and it does not add a migration.

## What the tree does now

`supabase/config.toml` has `[auth.mfa.totp]` with `enroll_enabled = false` and `verify_enabled = false`. Phone MFA is off the same way. A search of `supabase/migrations` found no policy that reads `aal` or requires a second factor before a row is read or written. Sign-in stays email and password for `127.0.0.1`.

## Why the flags stay off

Turning `enroll_enabled` and `verify_enabled` on only opens the local GoTrue TOTP API. It does not require AAL2 for an existing password session. The ERP has no enrollment screen, so those flags would not make sign-in stronger.

A database rule that rejects every `aal1` session would lock the local demo before anyone can enroll. That rule is not safe to apply in this change.

## Proposal, not applied

1. Keep password sign-in working for an account that has no factor.
2. Add an enrollment screen that calls the local GoTrue TOTP enroll and verify endpoints on loopback.
3. After that user enrolls, require `aal2` for that user on the next sign-in. An account with no factor stays at `aal1`.
4. Do not add an RLS policy that rejects `aal1` on every table.
5. Do not put the service-role key in the desktop binary to skip the check.

Until that screen exists, the config flags stay false and `supabase/migrations` stays unchanged.
