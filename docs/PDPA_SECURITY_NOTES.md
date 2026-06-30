# Security & PDPA Notes

> Summary of `docs/brainstorm/security-pdpa.md`. Practical, risk-ranked. **Not
> legal advice.** Thai PDPA (B.E. 2562) applies the moment real people's data is
> stored — including your own staff who log in.

## Top risks (ranked)

1. **Incomplete RLS** — a forgotten policy or the "single-org, skip it" shortcut
   silently exposes cross-tenant data once a second org exists.
2. **Service-role key in a request path or client bundle** — full RLS bypass.
3. **Real staff PII treated as "just demo"** — employees who log in are real PDPA
   data subjects today (lawful basis = employment, not consent).
4. **Cross-border transfer** — Supabase has no Thailand region; real data likely
   leaves Thailand (e.g. Singapore), triggering PDPA transfer rules.
5. **Demo data that looks real** — a "fake" email/tax ID that turns out real.
6. **Weak auth defaults** — unconfirmed emails, tokens in localStorage, open redirects.

## Must-fix for V1 (done / enforced here)

- ✅ `.env.example` only; `.env*` git-ignored. Key taxonomy documented:
  anon/publishable = client-safe; **service_role = server-only, seed-only, never
  shipped to client**.
- ✅ **RLS enabled + `force`d on every table** with an org-scoped policy via
  `private.is_org_member()`; deny-by-default. Written org-scoped even though V1 is
  single-org. (Verified: anonymous client sees 0 rows — `scripts/verify-seed.mjs`.)
- ✅ Service role used **only** in the seed; all request traffic uses the
  session-bound server client.
- ✅ Defense-in-depth: server actions re-derive `org_id` from `requireOrgContext()`
  and never trust a client-supplied org id.
- ✅ Auth via `@supabase/ssr` httpOnly cookies (no tokens in localStorage).
- ✅ Demo data is provably fake: `@boombignose.org` / `example.com`, fictional Thai
  company names, placeholder phone numbers, no tax IDs.
- ✅ Webhook secret compared in constant-time (`lib/webhooks/verify.ts`); reject on
  missing/mismatch.

### Recommended before real data
- Turn on **email confirmation** + a password policy in Supabase Auth; lock the
  allowed redirect URLs.
- Add a CI grep that fails the build if `SUPABASE_SERVICE_ROLE_KEY` appears under
  `app/`, `components/`, or `lib/`.

## Should-fix

- Lightweight **`audit_log`** for auth events and finance/CRM mutations (who, what,
  when, which entity). Full history later.
- Per-table policy review whenever a new table is added (keep org-scope drift at zero).

## Later (gated on real customer data + legal sign-off)

- Data-subject-rights workflow (access / rectification / erasure).
- Consent records / ROPA, retention schedule, breach-response runbook.
- Sub-processor DPA (Supabase) and a documented cross-border transfer safeguard,
  or move to an acceptable data region.

## Rule of thumb

Until the "before real data" items are done: **demo data only — do not enter real
customer or employee personal data.**
