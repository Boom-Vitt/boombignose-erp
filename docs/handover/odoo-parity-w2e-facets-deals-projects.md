# W2e search facets on deals and projects handover

2026-10-23. Branch `odoo-w2e-facets-deals-projects`, based on `924d3d7`.

## Changes

- Deals and Projects use the shared facet bar (`SearchFacets`) in both views, wired the same way as Quotes and Clients. Filters are My records, stage (deals) or status (projects), and period. Group by is stage or status, client, owner and expected close or deadline month.
- Deals gained a list view at `/deals?view=list`, which the coordinator approved. The board stays the default. Projects keep the list as the default and the board at `?view=board`. A shared `ViewSwitch` keeps the active facets on both links. Boards honour filters and ignore group by. A stage or status filter shows only that column, and cards can still move to any column.
- Period uses the deal's expected close date and the project's deadline. The filter panel says so. A record without that date never matches a period, and it groups under "No close date" or "No deadline".
- The projects list is now one table grouped by the chosen facet, as on Quotes. It was previously split into fixed status cards. With no group-by it is ungrouped and sorted by deadline, and it gained a Status column. Grouping by stage or status follows pipeline or lifecycle order.
- Existing deal links and saved views keep working. `parseFacets` reads the legacy `stage` param as the deals stage filter (`status` wins when both are present). Saved views stored as `{stage, q}` therefore load. Links now write `status`.
- The deals CSV export applies the same facets as the page. Export CSV moved into the page header and shows only its icon below `sm`, with "Export CSV" kept as its accessible name. `DealsToolbar` is deleted.
- Coordinator rule (1,000-row cap). The deals page, the deals export and the projects page load every row through `readAllOrThrow` (`lib/supabase/read-all.ts`), which pages a totally ordered query until a short page and throws if any page fails. Filters, group counts, group value totals and board column totals therefore cover the whole list. Deals take the client name from the embedded join, so client-name search does not depend on the separate client list, which is still capped and only feeds quick create.

## Shared files touched (additive)

- `lib/search-facets.ts` adds the `deals` and `projects` entries to `FACET_LISTS` (kept together in one block), the deals-only `stage` alias in `parseFacets`, and `date: string | null` in `matchesFacets`.
- `components/search/search-facets.tsx` adds one optional prop, `params?: Record<string, string>`. It holds non-facet query params (the view) that every facet link and the search form keep. Omitting it renders exactly as before. Two hint lines follow the existing finance hint.
- `app/(app)/views/actions.ts` adds the `projects` module and `stage` and `owner` to the `groupBy` enum. `save-view-button.tsx` adds `projects` to the module union. `saved_views.module` is free text, so no migration is needed.
- `lib/supabase/read-all.ts` (from the kanban track) gains id de-duplication and `readAllOrThrow`. See fix round 1.
- `e2e/v2.spec.ts` scopes one assertion to the deals board, because the facet panel now has a "Lead" filter link.
- Test fixtures `lib/supabase/__tests__/tenant-fixture.ts` and `lib/workflows/service-pages.test.ts` gain `range()`, and the tenant fixture resolves the embedded client.

## Files

- `app/(app)/deals/page.tsx`, `app/(app)/deals/export/route.ts`, `app/(app)/deals/_lib/deal-facets.ts` (new, the facet row shared by page and export), and `app/(app)/deals/_components/deals-toolbar.tsx` (deleted).
- `app/(app)/projects/page.tsx`, `app/(app)/projects/_components/projects-board.tsx` (passes `moveTargets`), and `app/(app)/projects/_components/view-switch.tsx` (new).
- Tests are `lib/search-facets-deals-projects.test.ts` (facet config, legacy alias, undated rows, the `params` prop, saved-view validation), `lib/queries/deals-projects-facets.test.ts` (renders both pages against a mocked, capped Supabase client), `lib/supabase/read-all.test.ts`, and `e2e/facets-deals-projects.spec.ts`.

## Fix round 1 (integrate odoo-parity, one pager)

- Merged `odoo-parity` at `9cc0cb7` (kanban review fixes, record-header counts, purchasing, web-to-lead, migrations). Conflicts were resolved by keeping both sides. `FACET_LISTS`, the saved-view module list, the `groupBy` enum and the save-view module union hold deals, projects, purchases and vendors together. The deals page keeps this track's query (expected close date, embedded client name, `getFacetSavedViews`) and reads next-activity dots from the kanban track's `deal_next_activity` view. The tenant fixture keeps both the embedded client and the 1,000-row cap with `count`.
- One pager. `lib/supabase/read-all.ts` is the only loop for the row cap. `readAll` now keeps one copy of any row with an `id`, which moves the insert-during-read fix over from `fetchAllRows`. Its `{ data, error }` result is unchanged for existing callers. `readAllOrThrow` wraps it for callers that used to throw, and a failed page throws an `Error` with that page's message. The deals page, the deals export, the projects page, `lib/purchasing/queries.ts`, `app/(app)/purchases/actions.ts`, the purchases and vendors pages, and the Finance costs list now use it. `lib/queries/fetch-all-rows.ts`, `lib/purchasing/pagination.ts` and their tests are deleted. Their de-duplication and failed-page message checks moved to `lib/supabase/read-all.test.ts`.
- Error handling. A failed deals or projects read still throws to the error boundary, as on this branch, so a board never shows an empty pipeline as if it were real. A failed `deal_next_activity` read only hides the activity dots, as on the kanban track.

## Verification

Fix round 1: all four gates passed again on the merged branch, each with exit code 0. Lint and typecheck were clean, 105 test files and 748 tests passed, and the build succeeded.

All four gates passed on `27a2f68`, each with exit code 0. Final lines:

```text
$ pnpm lint
$ eslint
$ pnpm typecheck
$ tsc --noEmit
$ pnpm test
 Test Files  93 passed (93)
      Tests  663 passed (663)
$ pnpm build
ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Lint and typecheck print nothing after the command line when clean.

**Page render tests.** `lib/queries/deals-projects-facets.test.ts` renders the real page components with a Supabase mock that returns at most 1,000 rows per request. It covers the legacy `?stage=won` link (one column, chip, export link), My records plus period narrowing the board, list grouping order with view-preserving links, a deal found beyond row 1,000, the filtered projects board keeping `view=board`, and deadline-month grouping with "No deadline". Removing the paging loop makes the beyond-cap test fail. With the loop restored, it passes.

**Layout check.** The server-rendered markup of five page states was loaded with the freshly built app CSS in headless Chromium. At 375px and 1440px, `document.documentElement.scrollWidth` equalled the viewport width in every state, and the page header ended at the 16px gutter. Screenshots of the grouped deals list, the phone-width deals board and the filtered projects board looked as intended. This used static markup without hydration or the sidebar, and the harness was not committed.

**Playwright e2e.** `e2e/facets-deals-projects.spec.ts` asserts that a Proposal filter chip narrows the deals board and that removing it restores the board, that the deals list groups by stage and keeps `view=list` when filtering, and that the projects board honours a status filter and stays on the board. These tests need the local Supabase stack, which was not started here (shared machine rule), so they have not been run.

**Review.** A separate Opus reviewer audited the branch diff and read the connected code. It found one e2e bug and four risks, and they were handled as follows. (1) The e2e `Board` link selector also matched the sidebar's "Dashboard" link. It is now exact. (2) Deal month groups followed creation order. Month grouping now sorts by expected close date with undated deals last, and the page test asserts the order. That test also caught a `localeCompare` sentinel that sorted undated deals first. (3) Offset paging could repeat a page-edge row if a deal was inserted mid-load. `fetchAllRows` now keys rows by id, with a test. (4) Saved views do not remember the view and (5) the projects list no longer groups by status by default. Both are listed under open issues. Running the full suite after the paging commit also showed that two existing Supabase mocks lacked `range()`. `lib/supabase/__tests__/tenant-fixture.ts` and `lib/workflows/service-pages.test.ts` now support it, and the tenant fixture resolves the `client:clients(...)` embed so the export isolation test still checks client names.

## Open issues

- The projects list no longer groups by status by default, which was a deliberate choice. It matches Quotes and the other facet lists, and `?groupBy=status` or a saved view restores the old grouping in lifecycle order. Keeping status as an implicit default would leave a grouping with no chip that can't be removed.
- Saved views store filters, not the view. Loading one from the deals list opens the board, and loading one from the projects board opens the list. Fixing it means adding `view` to the saved-view config in `app/(app)/views` (keys, Zod schema, loader), which this track did not own.
- `readAll` pages by offset. A delete during a multi-page load can skip one row for that render. Keyset paging would close this. Inserts are handled by keeping one row per id, but reads that select no `id` (the purchases page line totals, the `deal_next_activity` view) can still see a repeated page-edge row.
- `lib/mcp/data.mjs` keeps its own offset loop. It is a separate `.mjs` runtime that cannot import the TypeScript pager, so fix round 1 left it alone.
- The deals page still loads the client list for quick create with a plain capped query, so an org with more than 1,000 clients would miss some in that picker. The headline pipeline KPIs now cover every deal.
- `ViewSwitch` lives in `projects/_components` and deals imports it, as deals already does with `projects/_lib/profile-names`. If a third page needs it, it should move to `components/`.
- Facet status labels come from `facetLabel` ("In Progress"), while the board columns use the page's labels ("In progress"). This matches the other facet lists.
- Something that predates this track: a long `Search: …` chip can't wrap (`whitespace-nowrap`) and may overflow at 375px on every facet page.
