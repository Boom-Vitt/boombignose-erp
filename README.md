# BoomBigNose Company OS

AI-native **Company OS / lightweight ERP** for a Thai AI education + workflow-automation
studio. It's the **operational layer** for running the business — CRM, deals,
project delivery, finance visibility, a reusable automation-template library, and
a founder dashboard (cash, burn, revenue, pipeline, runway).

> It is **not** a legal accounting/tax system. Accounting integrates with
> FlowAccount / PEAK / Xero later. This product is the operating system, not the
> book of record.

## Features (V1)

- **Dashboard** — cash, monthly burn, revenue, unpaid invoices, MRR, open
  pipeline, active projects, runway, follow-ups due today, overdue items.
- **CRM** — clients, contacts, deals (pipeline board), activities/follow-ups.
- **Projects** — delivery board, tasks, milestones; create a project from a won deal.
- **Finance** — invoices, payments, costs, gross profit, MRR (operational, not legal).
- **Templates** — reusable automation/workflow library with checklists and pricing.
- **Automation hooks** — inbound n8n webhooks (`X-Webhook-Secret`).
- **Auth & roles** — Supabase Auth; owner / admin / member; single org (multi-tenant-ready).

## Tech stack

Next.js 16 (App Router) · TypeScript · Tailwind v4 · shadcn/ui (Base UI) ·
Supabase (Auth + Postgres, RLS) · Zod v4 · React Hook Form · Vitest · Playwright.

## Quick start (local)

Prereqs: **Node 20+**, **pnpm**, **Docker** (for local Supabase), and the
**Supabase CLI**.

```bash
# 1. install deps
pnpm install

# 2. start the local Supabase stack (Postgres + Auth + API) — needs Docker running
supabase start

# 3. apply migrations + load the demo seed
supabase db reset

# 4. create your env file from the example, then fill in the keys
cp .env.example .env.local
#   set NEXT_PUBLIC_SUPABASE_URL / ANON_KEY / SUPABASE_SERVICE_ROLE_KEY from:
supabase status

# 5. (optional) prove the seed + RLS work
set -a; source .env.local; set +a
node scripts/verify-seed.mjs

# 6. run the app
pnpm dev            # http://localhost:3000
```

**Demo login:** `demo@boombignose.org` / `BoomDemo123!` (also a one-click "Use
demo account" button on the login page). Two more seeded members:
`nattapong@boombignose.org`, `praewa@boombignose.org` (same password).

## Scripts

```bash
pnpm dev            # dev server
pnpm build          # production build
pnpm test           # unit tests (Vitest) — no database needed
pnpm typecheck      # tsc --noEmit
pnpm lint           # eslint
pnpm e2e            # Playwright smoke tests (needs the app running)
```

## Project structure

```
app/
  (app)/            authed area (dashboard + modules) — shares the sidebar layout
    dashboard/  clients/  deals/  projects/  finance/  templates/  settings/
  api/webhooks/n8n/ inbound automation endpoints (X-Webhook-Secret)
  login/  auth/signout/
components/          app-sidebar, nav registry, shared UI (page-header, stat-card, status-badge, ...)
  ui/               shadcn (Base UI) primitives
lib/
  supabase/         server + browser + middleware clients
  metrics/          PURE, unit-tested business logic (finance, pipeline, projects, invoice-status)
  money.ts dates.ts auth.ts queries/  types/database.ts
supabase/
  migrations/        schema + RLS
  seed.sql           fake Thai SME demo data
docs/                MVP_SPEC, IMPLEMENTATION_PLAN, MODULE_CONTRACT, brainstorm/, OPEN_CORE, PDPA, N8N, ROADMAP
.claude/agents/      project subagents used to build this
```

## Architecture notes

- **Money is integer satang** (`bigint`) everywhere; formatted with `formatTHB()`.
  Never floats.
- **RLS-first isolation**: every table has `org_id` and a `force`d RLS policy via
  `private.is_org_member()`. The service-role key is used **only** by the seed,
  never in a request path or the client bundle.
- **Pure business logic** lives in `lib/` and is fully unit-tested, so `pnpm test`
  needs no database.
- **Server Actions** handle all mutations (Zod-validated, org-scoped); Server
  Components handle reads.

## Cloud Supabase (instead of local)

Create a project at supabase.com, then `supabase link --project-ref <ref>`,
`supabase db push` (migrations), and run the seed against it. Put the project URL
and keys in `.env.local`. See `docs/PDPA_SECURITY_NOTES.md` for the data-region
(cross-border) consideration before using real data.

## License

Not finalized. See `docs/OPEN_CORE_STRATEGY.md` for the recommendation
(dual-license: AGPLv3 OR Commercial) and the Community-vs-Pro boundary.
`LICENSE` currently holds a placeholder until the founder decides.

## Status

Internal MVP. Demo data only — **do not enter real customer data** until the
PDPA items in `docs/PDPA_SECURITY_NOTES.md` are addressed.
