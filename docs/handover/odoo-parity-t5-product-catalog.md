# T5 product catalog handover

2026-10-23. Branch `odoo-t5-products`, based on `b4d9d69`.

## Changes

- Added an org-scoped products and services catalog with optional SKU, default unit, integer satang prices and costs, tax basis points, stockable flag, active status, and timestamps. Members can read their org catalog; owners and admins can create, edit, archive, and restore.
- Added `/products`, `/products/new`, `/products/[id]`, and `/products/[id]/edit`, with name/SKU search and active/archived/all filtering. Added one Products navigation entry.
- Added an accessible command picker to the existing quote and invoice line-entry forms. Selecting a product copies description, unit, and exact price. Users can adjust the copied values or keep free-text lines. Inline product creation preserves the current line.
- Added nullable tenant-qualified product references with `ON DELETE SET NULL (product_id)` and nullable unit snapshots for existing historical lines. Catalog changes do not rewrite document lines. Atomic quote conversion copies the saved product reference and unit.
- Seeded eight services matching the demo quote and invoice descriptions and linked the demo lines. Tax and inventory flags are stored for future work.

## Files

- `supabase/migrations/20261023130000_products.sql`, `supabase/tests/products.sql`, and `supabase/seed.sql`.
- `lib/products/{schema,snapshot,queries,actions}.ts` and four Vitest files under `lib/products/`.
- Four route pages and product form, picker, archive button, and toolbar under `app/(app)/products/`.
- Quote/invoice line form components and line actions. Detail-page changes only load picker options and display line units. Headers and history panels are untouched.
- Additive entries in `lib/types/database.ts`, `lib/permissions.ts`, and `components/nav.ts`.
- `e2e/products.spec.ts` covers catalog creation/edit/archive, quote and invoice snapshots, picker creation, editable copied values, and popup accessibility.

## Initial delivery verification

`pnpm lint` passed with exit code 0. Final output:

```text
$ eslint
```

`pnpm typecheck` passed with exit code 0. Final output:

```text
$ tsc --noEmit
```

`pnpm test` passed with exit code 0. Final output:

```text
Test Files  75 passed (75)
      Tests  547 passed (547)
   Start at  02:00:11
   Duration  2.54s (transform 4.31s, setup 0ms, import 25.29s, tests 1.28s, environment 4ms)
```

`pnpm build` passed with exit code 0. Final output:

```text
├ ƒ /timesheets
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Independent read-only source review found no remaining blockers after fixing create-option visibility under search, popup ARIA linkage, and cmdk's accessible search label. Comments review passed. Model the Domain guided a typed catalog-to-line snapshot instead of shared mutable product values. Existing money helpers supply all price math.

## Integration checks left

- No Docker or Supabase instance was started by this worker. The coordinator reported the original migration and 28-test SQL suite passed integration. The review-fix migration and expanded 34-test suite below need an integration run.
- Run `pnpm exec playwright test e2e/products.spec.ts` with the existing isolated-stack configuration. Browser smoke was authored but not run because it requires a database. SQL and browser execution were explicitly assigned to the coordinator.
- The migration replaces `convert_accepted_quote` from `20261014112000_conversion_lock_order.sql`, preserving its body except for copying `product_id` and `unit`. Reconcile any sibling migration that changes this function so migration order retains both changes. Deploy the migration before serving the updated UI.
- No dependencies were added, and nothing was pushed or merged.

## Review fix round 1

2026-10-23. Preserved coordinator commit `5085054`, which scopes the SKU count to the synthetic test orgs. Regression tests were committed first as `10575c9` and reproduced eight failures, including the repeated-query `.trim()` exception and lost PDF units.

- New migration `20261023130500_products_units.sql` replaces the existing issue command with the same authorization, locks, versions, totals, counters, and retry behavior, adding nullable line units to frozen JSON. The already-applied products migration is unchanged.
- Snapshot parsing preserves optional nullable units. Older snapshots with no unit remain printable, and no live unit is substituted. The shared HTML renderer escapes units beside quantity. Both invoice and quote PDF queries carry units. Space-padded database-valid units are retained without a new raw-length limit.
- `activeProductOptions` is now a scoped, validated server action returning at most 20 name/SKU matches. The picker debounces searches, ignores stale responses, retains the selected label, and provides loading/error/retry states. `lib/products/search.ts` shares literal search escaping with the catalog list.
- The catalog fetches 51 rows per stable name/id page, displays 50, and uses the last row to show Next. Search and status remain in navigation links. Repeated q/status/page parameters use their first value; invalid page numbers fall back to 1.
- Added regression coverage for snapshot/PDF units, escaping and legacy snapshots, repeated URL params, paging beyond offset 1,000, and bounded scoped typeahead. SQL coverage now has 34 assertions, including retained/null units on issuance, exact totals and retry stability.

`pnpm lint` passed with exit code 0. Final output:

```text
$ eslint
```

`pnpm typecheck` passed with exit code 0. Final output:

```text
$ tsc --noEmit
```

`pnpm test` passed with exit code 0. Final output:

```text
Test Files  76 passed (76)
      Tests  570 passed (570)
   Start at  02:18:43
   Duration  14.77s (transform 12.37s, setup 0ms, import 151.79s, tests 5.93s, environment 9ms)
```

`pnpm build` passed with exit code 0. Final output:

```text
├ ƒ /timesheets
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Independent source review approved the final fix after the padded-unit regression was addressed. A source comparison confirms the issue command differs only by the added JSON unit field and CREATE OR REPLACE declaration. `git diff --check` passes.

The new migration and expanded SQL suite have not been executed by this worker. The coordinator owns their integration database run and browser smoke. No new dependencies, push, or merge.
