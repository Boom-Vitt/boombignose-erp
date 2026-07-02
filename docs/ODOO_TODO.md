# Odoo parity — task backlog

Prioritized, actionable tasks to close the remaining in-scope Odoo gaps, plus
loose ends from the V3 modules already shipped (quotes, invoice line items,
timesheets, subscriptions). Effort: **S** ≈ ½ day · **M** ≈ 1–2 days · **L** ≈ 3–5 days.
Scope guardrails from `ROADMAP.md` still apply — no accounting ledger, tax engine,
inventory, or payroll.

---

## P0 — Finish / harden what we just shipped ✅ (done, except infra-scheduling / DB-verify)

### Wire new data into the dashboard & finance KPIs
- [x] Show open **quotes** value + count on the dashboard pipeline area (S)
- [x] Make MRR read from **subscriptions** (not just `is_recurring` invoices), or reconcile the two sources (M)
- [x] Add **billable-hours this month** + utilization stat to the dashboard from `time_entries` (S)

### Subscriptions cron
- [ ] Schedule `/api/cron/subscriptions` (Vercel Cron / GitHub Action) alongside the follow-ups cron (S) — *infra config, do at deploy*
- [x] Add an idempotency guard so a same-day double-run can't double-bill (deterministic `Name-YYYYMM` number + 23505 guard) (M)
- [x] Document the endpoint in `docs/N8N_INTEGRATION.md` (S)

### Quotes / line items polish
- [x] Auto-generate the next quote/invoice **number** instead of free-text entry (M)
- [x] Prevent editing line items once a quote is `converted` / an invoice is `paid` (S)
- [~] E2E smoke test: create quote → add items → accept → convert → invoice has items (M) — *page-load + detail smoke done; full create→convert flow needs a live app run*

### Tests & seed
- [x] Playwright smoke tests for `/quotes`, `/timesheets`, `/finance/subscriptions` (M)
- [ ] Verify `supabase db reset` loads the new seed rows cleanly (`scripts/verify-seed.mjs`) (S) — *needs a live DB*

---

## P1 — Highest-value remaining Odoo gaps

### Email integration (Odoo: CRM/Mail) — **L** ✅
- [x] Provider decision (Resend) + `.env` keys, graceful-degrade when unset
- [x] Send invoice / quote as email with the PDF link
- [x] Log outbound email as an `activity` on the client/deal
- [ ] Inbound reply capture (webhook → activity) — stretch

### Multi-org UX (model already multi-tenant) — **L** ✅
- [x] Org switcher in the sidebar (list memberships, set active org)
- [x] Invitations: invite by email → membership with role; accept flow (`/invite/[token]`)
- [x] Resolve "active org" from a cookie (`active_org`) instead of "first membership" in `getOrgContext`
- [x] Backfill RLS for invitations (accept runs service-role after token validation)

### Advanced RBAC — **M** ✅
- [x] Per-capability permission matrix (`lib/permissions.ts`, tested) — single source of truth
- [x] Gate sensitive actions via `requireCapability` (every `requireRole` call migrated to a named capability)
- [ ] Record-level rules (e.g. members see only their own deals) — *evaluated: not needed for MVP; RLS is org-level and capabilities cover per-member action gating*

---

## P2 — Product-tier features

### Client portal — **L**
- [ ] Tokenized read-only links for a client's quotes / invoices / projects
- [ ] "Accept quote" + "mark paid / upload slip" actions from the portal
- [ ] Separate RLS surface / portal auth

### Reporting & pivots — **M**
- [ ] Pivot-style report (revenue by client / month, hours by project)
- [ ] PDF export for reports (reuse `lib/documents/printable`)
- [ ] Scheduled report email — stretch

### Calendar / scheduling — **M**
- [ ] Calendar surface for `activities` (follow-ups, meetings) with due dates
- [ ] iCal feed per user — stretch

---

## P3 — Nice-to-have (evaluate before building)

- [ ] Web-to-lead capture form → `deals` (M)
- [ ] Expense approval workflow on `costs` (M)
- [ ] E-signature on accepted quotes (L)
- [ ] Product/service catalog to speed up line-item entry (M)

---

## Explicitly NOT doing (Odoo apps out of scope)

Full Accounting (ledger, VAT, e-Tax Invoice), Inventory/Warehouse,
Purchase/Procurement, Payroll/HR, Manufacturing (MRP), POS, eCommerce.
Accounting stays in FlowAccount / PEAK / Xero.
