# Odoo parity — task backlog

Prioritized, actionable tasks to close the remaining in-scope Odoo gaps, plus
loose ends from the V3 modules already shipped (quotes, invoice line items,
timesheets, subscriptions). Effort: **S** ≈ ½ day · **M** ≈ 1–2 days · **L** ≈ 3–5 days.
Scope guardrails from `ROADMAP.md` still apply — no accounting ledger, tax engine,
inventory, or payroll.

---

## P0 — Finish / harden what we just shipped

### Wire new data into the dashboard & finance KPIs
- [ ] Show open **quotes** value + count on the dashboard pipeline area (S)
- [ ] Make MRR read from **subscriptions** (not just `is_recurring` invoices), or reconcile the two sources (M)
- [ ] Add **billable-hours this month** + utilization stat to the dashboard from `time_entries` (S)

### Subscriptions cron
- [ ] Schedule `/api/cron/subscriptions` (Vercel Cron / GitHub Action) alongside the follow-ups cron (S)
- [ ] Add an idempotency guard so a same-day double-run can't double-bill (unique on `subscription_id + period`) (M)
- [ ] Document the endpoint in `docs/N8N_INTEGRATION.md` (S)

### Quotes / line items polish
- [ ] Auto-generate the next quote/invoice **number** instead of free-text entry (M)
- [ ] Prevent editing line items once a quote is `converted` / an invoice is `paid` (S)
- [ ] E2E smoke test: create quote → add items → accept → convert → invoice has items (M)

### Tests & seed
- [ ] Playwright smoke tests for `/quotes`, `/timesheets`, `/finance/subscriptions` (M)
- [ ] Verify `supabase db reset` loads the new seed rows cleanly (`scripts/verify-seed.mjs`) (S)

---

## P1 — Highest-value remaining Odoo gaps

### Email integration (Odoo: CRM/Mail) — **L**
- [ ] Provider decision (Resend/Postmark) + `.env` keys, graceful-degrade when unset
- [ ] Send invoice / quote as email with the PDF link
- [ ] Log outbound email as an `activity` on the client/deal
- [ ] Inbound reply capture (webhook → activity) — stretch

### Multi-org UX (model already multi-tenant) — **L**
- [ ] Org switcher in the sidebar (list memberships, set active org)
- [ ] Invitations: invite by email → membership with role; accept flow
- [ ] Resolve "active org" from a cookie instead of "first membership" in `getOrgContext`
- [ ] Backfill RLS/tests for the switch path

### Advanced RBAC — **M**
- [ ] Per-module permission matrix beyond owner/admin/member
- [ ] Gate sensitive actions (delete, convert, generate-invoice) consistently
- [ ] Record-level rules (e.g. members see only their own deals) — evaluate need

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
