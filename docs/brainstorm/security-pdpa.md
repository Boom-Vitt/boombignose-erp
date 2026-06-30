# Security & PDPA Notes — BoomBigNose Company OS

**Scope & framing.** This is a *guardrails-for-the-V1-build* document, not an audit of existing code — the repo is currently a skeleton (no `package.json`, no migrations, no `.env.example`, empty `supabase/`). The one real artifact, `.gitignore`, already ignores `.env*` and tracks `.env.example` correctly — but `.env.example` itself doesn't exist yet, so creating it is a real task.

**The discriminator for every tier decision below:** V1 is **internal-only** and runs on **demo / fake data**. That test collapses most scary-sounding PDPA machinery into "Later," while keeping cheap foundational hygiene (RLS, secrets, auth) as Must-fix — those mistakes compound and are nearly free to prevent now. One nuance that does *not* collapse: the studio's own staff who log in are **real data subjects today**.

---

## MUST-FIX (block V1 ship)

These are cheap now, catastrophic to retrofit, and survive the internal+fake-data test.

- **[Secrets] Create `.env.example` with placeholder values only.** Document the key taxonomy inline:
  - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (anon/publishable) — **safe to ship to the client**; RLS is what protects data, not key secrecy.
  - `SUPABASE_SERVICE_ROLE_KEY` — **server-only, seed-script-only**. It *bypasses RLS*. Never import it into a Server Action request path, a React component, or anything in the client bundle.
  - Never commit a real `.env` / `.env.local` (already ignored — keep it that way).
- **[Secrets/CI] Guard the service-role key.** Confine it to `supabase/seed.ts` (or a `scripts/` seeder). Add a CI grep that fails if `SERVICE_ROLE` appears anywhere under `app/`, `components/`, or `lib/` outside the seed path. A leaked service-role key = total tenant bypass.
- **[RLS] Enable RLS + at least one org-scoped policy on EVERY table, deny-by-default.** The trap is "it's single-org in V1, skip RLS." Don't — write policies org-scoped *now* (`org_id IN (SELECT org_id FROM memberships WHERE user_id = auth.uid())`). A table with RLS off, or RLS on with no policy that the service role then reads around, is the #1 data-isolation risk. **Concrete guard:** run Supabase's security advisor (`get_advisors`) and/or a CI query over `pg_policies`/`pg_class` that fails if any table in `public` lacks RLS or has zero policies.
- **[RLS] Never use the service role in a request path.** All user-facing reads/writes go through the Supabase *server client bound to the user's session cookie*. Service role only in offline seeding.
- **[RLS] Defense-in-depth in Server Actions.** Re-derive the caller's org from `memberships` server-side on every mutation; never trust a client-supplied `org_id`/`tenant_id` in the payload. RLS is the backstop, not the only check.
- **[Auth] Harden Supabase Auth basics:** require email confirmation; enable a password policy (length + leaked-password check); sessions in **httpOnly cookies via `@supabase/ssr`**; **no access/refresh tokens in `localStorage`**. Lock down the allowed redirect URLs.
- **[Demo data] Make all demo data provably fake.** No real names, emails, phones, or tax IDs. Use `@example.com` / `@example.org`, clearly fictional Thai company names (e.g., "บริษัท สมมติ จำกัด / Mock Trading Co."), reserved/0xx phone ranges, and **13-digit tax IDs that deliberately fail the Thai checksum** so they can't collide with a real juristic-person ID. This is the safest hedge against accidental PDPA exposure in V1.
- **[Secrets, conditional] Webhook secret (`X-Webhook-Secret`):** if inbound webhooks exist in V1, compare with a **constant-time** check and reject on missing/mismatched header. If no webhook receiver ships in V1, this defers — but keep the placeholder in `.env.example`.

---

## SHOULD-FIX (do for V1 if time allows; not a hard ship-blocker)

- **[Audit] Minimal `audit_log` table.** Columns: `actor_id`, `action`, `entity_type`, `entity_id`, `created_at`, `metadata jsonb`. Append-only (no UPDATE/DELETE policy). In V1, log **auth events + finance and CRM mutations** (create/edit/delete of clients, deals, invoices). Full field-level change history is **Later**. Worth it now because finance visibility implies someone will eventually ask "who changed this number?"
- **[PDPA — your own staff] Basic privacy posture for real users.** The staff logging in are real data subjects *today*. Lawful basis is the **employment relationship / legitimate interest — not consent** (don't build a consent flow for employees). Action: a one-paragraph internal note stating what staff data you hold (name, email, auth metadata, audit trail) and why. This is posture, not paperwork.
- **[Auth] Role model via `memberships.role`** (owner/admin/member) enforced in policies and actions, so finance visibility can be scoped before real data exists.
- **[Secrets] Rotate the demo project's keys** before any non-internal exposure, and confirm the Supabase project isn't a shared/personal one.

---

## LATER (document now, build before external customers — with legal sign-off)

Everything here is gated on **"before onboarding real customer data."** Document the intent; do not build in V1.

- **[PDPA] Cross-border transfer.** Supabase has **no Thailand region**; Singapore (`ap-southeast-1`) is the usual SEA choice, so transfer of personal data out of Thailand is almost certainly in play. **Verify the actual region** (check `NEXT_PUBLIC_SUPABASE_URL` once provisioned, or ask) rather than assuming. If outside TH (likely), document the appropriate-safeguards basis required under PDPA's cross-border rules. For V1 internal+fake data the risk is negligible; for real data it is a gating item.
- **[PDPA] Data subject rights workflows** — access, rectification, erasure, portability. Needs a process + tooling (export an individual's data, delete-on-request honoring the audit-log retention exception). Defer.
- **[PDPA] Lawful basis / consent management for *customer* data**, a Record of Processing Activities (ROPA), and a DPO-need assessment. Defer to legal.
- **[PDPA] Retention schedule + breach-notification runbook** (PDPA expects notification to the regulator, generally without undue delay). Draft before real data.
- **[PDPA] Sub-processor due diligence / DPA with Supabase** (and any future processors). Defer.
- **[Security] Hardening for multi-tenant prod:** rate limiting, MFA, secrets manager (not `.env`), per-tenant key isolation review, pen test, dependency scanning, full audit-log retention + tamper evidence.

> Note on citations: obligations above are stated in plain language deliberately. PDPA section-number precision belongs to a lawyer at the "real customers" stage; wrong numbers in an engineering doc do more harm than good.

---

## TOP RISKS (ranked)

1. **Missing/incomplete RLS** (esp. the "single-org, skip it" shortcut) — silent cross-tenant data exposure the moment a second org exists. *Mitigation: deny-by-default policies on every table + CI policy check.*
2. **Service-role key reaching a request path or client bundle** — full RLS bypass. *Mitigation: seed-only confinement + CI grep.*
3. **Real staff PII treated as "just demo"** — V1 already processes real personal data of employees. *Mitigation: employment-basis note; don't conflate with fake customer data.*
4. **Cross-border transfer assumed compliant** — non-TH Supabase region triggers PDPA transfer rules for real data. *Mitigation: verify region; document safeguards before real customers.*
5. **Demo data not obviously fake** — a realistic-looking tax ID or email that turns out real is an avoidable PDPA incident. *Mitigation: checksum-failing tax IDs, example.com/.org.*
6. **Weak auth defaults** — unconfirmed emails, tokens in localStorage, open redirects. *Mitigation: confirmation on, httpOnly cookies, locked redirects.*
