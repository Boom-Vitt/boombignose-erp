# Odoo parity t4 search and charts

Completed 2026-10-23 on `odoo-t4-search-charts`, based on local main `b4d9d69`.

## Changes

- Added one URL-driven search/facet bar to Quotes, Finance invoices, Clients and Timesheets. Search, status, period, My records and grouping produce removable chips. Its panel contains Filters, Group by and Saved columns.
- Quotes/invoices group by status, client or month. Clients group by industry, source or creation month. Timesheets group by project or work month. Group headers show record counts and integer-satang sums where amounts exist. One grouping and one status/period are active at a time.
- Reused `saved_views`, its existing save/delete controls and per-user/org scoping. Added quotes/timesheets modules and period/mine/groupBy config keys. No migration or dependency is required. Additive shared view changes were approved by the coordinator.
- My records uses quote/client owner or timesheet author. Invoices have no owner field, so that filter uses the related client owner, explained in the panel. Financial/monthly summary cards remain workspace-wide.
- Added pure Bangkok period and URL helpers, with tests for rollover, leap month, exclusive boundaries, repeated/invalid parameters, combined facets and saved-view round trips.
- Reports default to bar charts for revenue by month, revenue by client and hours by project. `?view=line` selects SVG lines and `?view=pivot` restores the existing tables. This reuses the dashboard's CSS-bar approach without a chart dependency. Verified cash and the existing six-month Bangkok range remain the report definitions. Print output is retained.

## Files

- `components/search/search-facets.tsx`, `components/search/grouped-table-rows.tsx`.
- `lib/search-facets.ts`, `lib/periods.ts`, `lib/queries/saved-views.ts` and their tests.
- `app/(app)/quotes/page.tsx`, `app/(app)/finance/page.tsx`, `app/(app)/clients/page.tsx`, `app/(app)/timesheets/page.tsx`.
- `app/(app)/views/actions.ts`, `view-config.ts`, `save-view-button.tsx`.
- `app/(app)/reports/page.tsx`, `_components/report-chart.tsx`, `lib/report-chart.test.ts`.
- `lib/queries/dashboard.test.ts`, `lib/queries/saved-view-actions.test.ts`, `lib/search-facets-ui.test.ts`, `e2e/search-charts.spec.ts`.
- This handover. No deals page, project list, shared navigation, permissions or database types changed.

## Why demo revenue is zero next to ฿188,000 burn

Source investigation found expected behavior, rather than a month calculation bug.

1. `supabase/seed.sql:133` inserts two current-month receipts, 9,000,000 and 4,000,000 satang, without `verification_state`.
2. `supabase/migrations/20261014090000_payment_security_pilot.sql:23` defaults those receipts to `legacy_unverified`.
3. `lib/queries/dashboard.ts` selects only `verification_state = verified` before `revenueForMonth` aggregates by Bangkok month. Those demo receipts therefore contribute zero until evidence is verified/reconciled through the existing flow. Changing dates or treating legacy receipts as verified would misstate revenue.
4. The five current-month seed costs total 18,800,000 satang, or ฿188,000. Seed `monthly_burn_satang` is null, so the dashboard uses that computed cost sum.

`lib/queries/dashboard.test.ts` exercises the real dashboard aggregator with source-equivalent fixtures. It asserts zero revenue against 18,800,000 satang burn, then 13,000,000 satang revenue when those receipts are verified. No live database state was read or altered, and production revenue logic was left intact.

## Verification

Initial delivery gate output, all exit codes zero.

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  78 passed (78)
      Tests  541 passed (541)
   Start at  01:57:22
   Duration  2.81s (transform 5.04s, setup 0ms, import 30.25s, tests 1.46s, environment 4ms)

pnpm build
├ ƒ /timesheets
└ ƒ /warehouse

ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` passed. Server-render tests verify chip removal links, preserved hidden form fields, count/satang headers, chart labels, SVG coordinates and empty/zero data. Saved-view tests cover persistence, invalid config rejection and current user/org/module scoping. Project-local memory reader checks passed.

### Fix round 1, 2026-10-23

Addressed all three independent-review findings with regression tests committed first in `dc3cb07`.

- Client name search now applies an escaped `.ilike()` predicate before Supabase's row cap. LIKE wildcards, backslashes and PostgREST punctuation remain literal search text. The direct column predicate also avoids embedding user input in `.or()` grammar. Other URL facets remain active.
- Saved-view config parsing explicitly excludes JSON null and arrays before `Object.entries`.
- Industry/source group keys prefix every present value with `value:` and reserve `missing` for null. Actual data named `unassigned` or `missing` cannot share the missing-value key.
- The existing tenant fixture now decodes escaped literal search text, preserving its CLIENT_A search assertion.

Before production fixes, the focused command `pnpm exec vitest run lib/queries/clients-facets.test.ts lib/queries/saved-views.test.ts` reported:

```text
 Test Files  2 failed (2)
      Tests  5 failed | 4 passed (9)
```

The failures covered omitted server predicates, the missing client beyond the first 1,000 rows, merged industry/source headers and `Object.entries(null)`. After the fixes the same command reported 2 files and 9 tests passed. Including the existing active-workspace page tests reported 3 files and 27 tests passed. These exercise the actual page/loader with a capped query fixture and server-rendered output; no live database behavior is claimed.

Final fix-round gates all exited zero:

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  79 passed (79)
      Tests  548 passed (548)
   Start at  02:07:26
   Duration  3.91s (transform 7.15s, setup 0ms, import 41.77s, tests 1.61s, environment 14ms)

pnpm build
├ ƒ /timesheets
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` also passed. Authenticated Playwright and patch-current independent review remain assigned to the coordinator.

## Remaining integration checks and limits

- Per coordinator instruction, authenticated Playwright was written but not run here. This worktree has neither `.env.local` nor `.local-stack/isolation.json`, which the existing Playwright config requires. No Docker/Supabase service was started. On the isolated integration stack, build with its environment and run `pnpm exec playwright test e2e/search-charts.spec.ts`. The scenarios apply Sent and Status grouping to the seeded quote, verify chips/header across reload/removal, and switch reports between bar, line and pivot views.
- As on the existing pages/reports, queries inherit `supabase/config.toml:18`'s 1,000-row API cap. Group totals describe the loaded rows; server pagination/whole-dataset aggregation for larger workspaces remains outside this track. The old additional 100-entry Timesheets limit was removed.
- Existing invoice CSV export still applies only status; its button is retained with that scope stated beside it. Other facets do not silently claim to filter the export.
- Independent integration review belongs to the coordinator. Nothing was pushed or merged.
