# Implementation Plan — BoomBigNose Company OS

Bite-sized, TDD-first tasks. Strict TDD applies to the **pure-function core**
(runway, dashboard metrics, invoice status, pipeline, project profit, webhook
validation). Each task lists objective, files, tests, and a verification command.

Status legend: ✅ done · ⏳ in progress · ⬜ planned

## Phase 0 — Foundation ✅

| # | Task | Files | Verify |
|---|---|---|---|
| 0.1 | Scaffold Next.js 16 + TS + Tailwind v4 + shadcn (Base UI) | `app/`, `components/ui/**`, configs | `pnpm build` |
| 0.2 | Supabase clients + middleware + auth/org helpers | `lib/supabase/**`, `middleware.ts`, `lib/auth.ts` | `pnpm typecheck` |
| 0.3 | Schema migrations (15 tables, enums, indexes, RLS) | `supabase/migrations/**` | `supabase db reset` |
| 0.4 | Generated DB types | `lib/types/database.ts` | `supabase gen types` |
| 0.5 | RLS-safe Thai demo seed (3 users, org, data) | `supabase/seed.sql` | `node scripts/verify-seed.mjs` |
| 0.6 | App shell, sidebar nav, shared UI primitives | `app/(app)/layout.tsx`, `components/**` | `pnpm build` |

## Phase 1 — Pure-logic core (strict TDD) ✅

Write the test, then the function. All DB-independent.

| # | Function | Files | Verify |
|---|---|---|---|
| 1.1 | Money satang + `formatTHB` | `lib/money.ts` (+ `.test.ts`) | `pnpm test` |
| 1.2 | Dates (Bangkok today/month/past-due) | `lib/dates.ts` | `pnpm test` |
| 1.3 | Invoice status derivation | `lib/metrics/invoice-status.ts` | `pnpm test` |
| 1.4 | Finance: revenue, costs, MRR, unpaid, net burn, **runway** | `lib/metrics/finance.ts` | `pnpm test` |
| 1.5 | Pipeline: value, weighted, by-stage | `lib/metrics/pipeline.ts` | `pnpm test` |
| 1.6 | Project profit | `lib/metrics/projects.ts` | `pnpm test` |
| 1.7 | Webhook secret (constant-time) | `lib/webhooks/verify.ts` | `pnpm test` |

**Acceptance:** `pnpm test` → 43 passing.

## Phase 2 — Dashboard ✅

Objective: render real metrics from seeded data.
Files: `lib/queries/dashboard.ts`, `app/(app)/dashboard/page.tsx`.
Verify: `pnpm build` + log in as demo and confirm non-empty cards.

## Phase 3 — Modules (parallel) ⏳

Each module: list + create/edit + detail, server actions (`requireOrgContext`,
Zod, `revalidatePath`), shared status badges, money in satang. See
`docs/MODULE_CONTRACT.md`.

| # | Module | Lane | Key actions |
|---|---|---|---|
| 3.1 | CRM | `app/(app)/clients/**` | clients + contacts CRUD |
| 3.2 | Deals | `app/(app)/deals/**` | pipeline, stage change, activities |
| 3.3 | Projects | `app/(app)/projects/**` | from-won-deal, tasks, milestones |
| 3.4 | Finance | `app/(app)/finance/**` | invoices, payments (status recompute), costs |
| 3.5 | Templates | `app/(app)/templates/**` | templates + categories |
| 3.6 | Webhooks + Settings | `app/api/webhooks/**`, `app/(app)/settings/**` | secret-validated hooks; org settings |

Verify after integration: `pnpm typecheck && pnpm lint && pnpm build`.

## Phase 4 — Quality gates ⬜

1. Adversarial review vs `MVP_SPEC` acceptance criteria (Opus reviewer).
2. `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` all green.
3. Playwright smoke: `/login` → demo → `/dashboard` renders metrics.
4. Re-run `node scripts/verify-seed.mjs`.

## Phase 5 — Docs & licensing ⬜

`README.md`, `docs/OPEN_CORE_STRATEGY.md`, `docs/PDPA_SECURITY_NOTES.md`,
`docs/N8N_INTEGRATION.md`, `docs/ROADMAP.md`, `LICENSE` (placeholder until chosen).

## Verification commands

```bash
supabase start && supabase db reset      # local DB + migrations + seed
node scripts/verify-seed.mjs             # login + RLS proof
pnpm test                                # unit tests (no DB needed)
pnpm typecheck && pnpm lint && pnpm build
pnpm dev                                 # http://localhost:3000  (demo@boombignose.org / BoomDemo123!)
```
