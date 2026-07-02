# BoomBigNose Company OS vs Odoo — feature comparison & gap plan

> Odoo is a full modular ERP suite (40+ apps). BoomBigNose Company OS is a
> deliberately **lightweight, AI-native operational layer** — it hands accounting,
> tax, inventory, and payroll to FlowAccount / PEAK / Xero (see
> [`ROADMAP.md`](./ROADMAP.md) non-goals). The goal below is **not** to match Odoo
> app-for-app, but to close the real gaps *within our chosen scope*.

## Module map

| Company OS module | Odoo equivalent | Status |
|---|---|---|
| Dashboard (cash, burn, MRR, runway, pipeline, overdue) | Dashboards / Accounting KPIs | ✅ Strong (founder-focused) |
| CRM (clients, contacts, deals pipeline, activities) | CRM | 🟡 Core there; no lead scoring / email sync / multi-pipeline |
| Projects (board, tasks, milestones, from-won-deal) | Project | 🟡 Core there; **timesheets added (V3)**, no Gantt |
| **Quotes / Sales Orders** | Sales | ✅ **Added in V3** (quote → accept → invoice) |
| Finance (invoices, payments, costs, profit, MRR) | Invoicing (not full Accounting) | 🟡 Operational only — no tax engine (by design) |
| **Invoice line items + printable PDF** | Invoicing | ✅ **Added in V3** |
| **Recurring invoices / Subscriptions** | Subscriptions | ✅ **Added in V3** (cron-generated, feeds MRR) |
| **Timesheets** | Timesheets | ✅ **Added in V3** |
| Templates / automation library | Studio / Automation | 🟡 Partial |
| n8n webhooks + cron follow-ups | Automation rules | 🟡 Partial |
| Audit log, CSV export, saved views | Audit / Export | ✅ Good |
| AI assists (deal summary, follow-up drafts, intake) | Odoo AI | ✅ Ahead of stock Odoo |
| Auth, roles owner/admin/member | Users / groups | 🟡 Basic RBAC |

## Delivered in V3 (this batch)

Four Odoo feature-gaps, built end-to-end (schema + RLS + server actions + UI +
unit-tested pure logic):

1. **Quotations / Sales Orders** — `quotes` + `quote_items`, line-item pricing,
   status flow (draft → sent → accepted → converted), printable PDF, and
   one-click **convert-to-invoice** (copies line items).
2. **Invoice line items + printable PDF** — `invoice_items`; an invoice's total is
   derived from its items; `/finance/invoices/[id]/pdf` renders a print-to-PDF doc.
3. **Timesheets** — `time_entries` (minutes, billable, hourly rate); logged on the
   project or the Timesheets page; feeds hours / billable value / utilization.
4. **Recurring invoices / Subscriptions** — `subscriptions` generate invoices on a
   cadence via `/api/cron/subscriptions` (secret-gated); this is the engine behind
   the MRR metric.

Shared, unit-tested business logic lives in `lib/metrics/line-items.ts`,
`lib/metrics/timesheets.ts`, `lib/billing/recurring.ts`, and the printable-doc
renderer `lib/documents/printable.ts`.

## Still open — within scope (recommended next)

Ranked; these remain genuine gaps vs Odoo that fit our positioning:

1. **Email integration** — log/send email from CRM (Odoo's core strength). Today
   follow-ups only queue to LINE via n8n.
2. **Multi-org UX** — org switcher + invitations (schema is already multi-tenant).
3. **Advanced RBAC / record rules** — beyond the 3 flat roles.
4. **Client portal** — clients view their quotes / invoices / projects.
5. **Reporting builder / pivot views** — beyond fixed dashboards + CSV.
6. **Calendar / scheduling surface** for activities.
7. Lead capture (web-to-lead) forms, expense approval workflow, e-signature on
   quotes.

## Deliberately NOT building (Odoo apps out of scope)

Confirmed against `ROADMAP.md` non-goals — these would turn the product into a
heavy ERP and duplicate FlowAccount / PEAK / Xero:

- ❌ Full **Accounting** (ledger, VAT/tax engine, e-Tax Invoice)
- ❌ **Inventory / Warehouse**
- ❌ **Purchase / Procurement**
- ❌ **Payroll / HR** engine
- ❌ **Manufacturing (MRP)**, POS, eCommerce website builder
