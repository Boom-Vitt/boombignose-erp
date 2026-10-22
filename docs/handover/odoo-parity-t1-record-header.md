# Odoo parity t1: record header

Branch `odoo-t1-record-header`, based on `main` at b4d9d69. One migration, `20261023150000_client_balances.sql`, adds three read-only views (fix round 1).

## What changed

Six record pages now open with the same header. A breadcrumb trail links back to the list, linked-record buttons show live counts, and a status bar draws the document's stages as chevrons with one primary action for the next step.

- **Status tables.** `lib/record/status.ts` holds one typed table per document type (quote, invoice, deal, project, subscription) over the existing enums. Each table lists the chevron stages, which off-line statuses still sit on a stage (an overdue or partially paid invoice sits on Sent), and the next actions per status with at most one primary. An action is either a status change, which runs through the document's existing server action, or a named command the page supplies (quote conversion, invoice issue, payment, project creation). `statusBar()` derives what to draw. Statuses that are not stages (declined, expired, lost, paused, cancelled) render as a badge beside the chevrons.
- **Semantic tones.** `STATUS_DISPLAY` in the same file is the one label and tone per status value. `components/status-badge.tsx` reads it through a generic `StatusBadge`. The existing named badges stay as one-line wrappers, and the quote and subscription badge files now re-export the shared one, so list pages pick up the new colors without edits. The violet "progress" tone is gone. In progress, proposal and negotiation are blue. Paused, partially paid and expired are orange. Cancelled is grey.
- **Breadcrumbs.** `PageHeader` takes an optional `breadcrumbs` list of ancestors and closes the trail with the title. Detail pages show Module / Record. Top-level list pages already show their module as the title, so they are unchanged. The nested Subscriptions list shows Finance / Subscriptions. The Back buttons on the six detail pages are removed because the breadcrumb replaces them.
- **Status bar.** `components/record/status-bar.tsx` (server component) renders the actions and an `<ol aria-label="… status">` whose current step has `aria-current="step"`. Plain status changes use `components/record/transition-button.tsx`. A command is either an href or a render function. The page offers only what the user may do. Transitions are omitted for members on subscriptions, conversion is offered only when the old `canConvert` held, invoice issue and payment only for non-members with the same conditions as the forms they link to. On phones only the current step shows.
- **Smart buttons.** `components/record/smart-buttons.tsx` hides a zero count unless the button is flagged as the next step. One linked record opens it, several open the page section or list that shows them.

| Page | Status bar | Smart buttons |
|---|---|---|
| Quote | Draft, Sent, Accepted, Converted. Mark sent, Accept / Decline, Create project and draft invoice | Invoices (by `source_quote_id`), Project |
| Invoice | Draft, Sent, Paid, keyed by the effective status. Issue invoice and Record payment jump to the existing forms | Payments (verified), Source quote, Project |
| Deal | Lead to Won. Next stage, Mark lost, Create project when no project exists yet, Reopen when lost | Quotes (through the deal's projects), Projects |
| Project | Not started to Support. Start, Send for review, Mark delivered, Pause, Resume | Tasks done/total, Hours logged, Invoices (next step once delivered), Quotes |
| Client | None, clients have no status | Deals, Quotes, Invoices, Projects, Open balance |
| Subscription | Active. Pause, Cancel, Activate (owners and admins) | Invoices (through `subscription_occurrences`), Project |

Behaviour moved, not added. The quote's Mark sent, Accept, Decline and convert buttons moved from the overview card into the status bar, and conversion keeps its idempotency key in `quotes/_components/convert-quote-button.tsx` (the old `quote-status-controls.tsx` is deleted and its test now targets the new button). The subscription Activate, Pause and Cancel buttons moved from `SubscriptionControls` into the bar. Generate invoice and Delete stay in the card. The deal's Create project header button is now the status bar's primary action on won deals, and it disappears once the deal has a project. The deal stage select and project status select stay for jumps the next-step buttons do not cover.

## Files

- New: `lib/record/status.ts`, `lib/record/status.test.ts`, `components/record/status-bar.tsx`, `components/record/transition-button.tsx`, `components/record/smart-buttons.tsx`, `app/(app)/quotes/_components/convert-quote-button.tsx`, `e2e/record-header.spec.ts`.
- Changed: `components/page-header.tsx`, `components/status-badge.tsx`, the six detail pages, `app/(app)/finance/_components/subscription-controls.tsx`, the two local badge files (now re-exports), `app/(app)/finance/subscriptions/page.tsx` (one breadcrumb prop), `lib/workflows/service-controls.test.ts`.
- Deleted: `app/(app)/quotes/_components/quote-status-controls.tsx`.
- Fix round 1: `supabase/migrations/20261023150000_client_balances.sql`, `supabase/tests/client_balances.sql`, `lib/record/change-stage-select.test.ts`, `lib/types/database.ts` (the three views), `app/(app)/deals/_components/change-stage-select.tsx`, the six detail pages, `components/record/smart-buttons.tsx`, `lib/workflows/service-pages.test.ts` (its query mock gains `limit`).

## Fix round 1

The independent review found two defects. Both are fixed, each with a test committed before its fix.

- **Client balance past the row cap.** The client page summed verified receipts from a list that the API stops at 1,000 rows (`max_rows`), while it reported the balance as complete. A ฿1,001 invoice paid by 1,001 verified ฿1 receipts showed ฿1 outstanding. The migration adds `security_invoker` views. `invoice_balances` holds each invoice's verified receipts and what it still owes. `client_balances` sums issued invoices per client with the dashboard's rules: drafts and cancelled invoices are excluded, only verified receipts count, and an overpaid invoice owes zero. `project_time_totals` sums logged minutes per project. Each view runs under the caller's RLS. `anon` has no grant, and `authenticated` may only select. The client page reads `client_balances`, and the invoice page now reads its paid total from `invoice_balances`, because that page had the same capped sum and feeds the status bar.
- **Stale stage select.** After a status-bar transition, `ChangeStageSelect` kept the old stage because `useState(stage)` ignored the refreshed prop. The component now follows the prop when it changes, using React's "adjust state when a prop changes" pattern, so it is fixed for every caller and not only the deal page. A rejected change still reverts.
- **Exact counts.** The coordinator extended the round to the row-cap rule for every smart button. Each count is now a `count: "exact"` read. Lists the page renders anyway gain `count: "exact"`, and id-only reads are `limit(1)` reads, because `recordHref` needs only the first row when the count is one. Done tasks use a `head: true` count. Hours logged comes from `project_time_totals`, and the time card uses the same number. The deal page finds its quotes through an inner join on its projects (`projects!quotes_project_id_fkey_tenant!inner`), so it no longer passes project ids in the URL.

## Verification

All four gates pass on the final commit. Final lines of each:

```text
$ pnpm lint
$ eslint
(exit 0, no findings)

$ pnpm typecheck
$ tsc --noEmit
(exit 0)

$ pnpm test
 Test Files  73 passed (73)
      Tests  556 passed (556)

$ pnpm build
ƒ  (Dynamic)  server-rendered on demand
(exit 0)
```

`lib/record/status.test.ts` (34 tests) checks that every flow covers every value of its enum, that declined, lost and cancelled never appear as chevrons and render as a badge, that no action targets the record's own status, the done, current and upcoming step states, that an overdue invoice sits on Sent with a badge, that unavailable actions drop without promoting a secondary, that every quote transition passes `quoteTransitionError`, and the brief's tone mapping.

The Playwright smoke `e2e/record-header.spec.ts` was written but not run, because it needs the Supabase stack and this track may not start it. It opens QUO-2026-001 and INV-2026-001 from their lists and asserts the breadcrumb root link, a status list with exactly one current step, and a Project smart button. Both seeded records link to a project. The coordinator runs it on the integration stack.

The new components were rendered to static HTML with the production CSS and screenshotted with Chromium at 1280, 700 and 390 px. Chevrons, side badges and the phone layout render as intended with no horizontal page overflow. The full pages were not seen in a browser because they need the database.

Fix round 1. The four gates above were rerun on the final commit. The SQL test runs on the local stack inside one transaction with the migration, then rolls back, so the shared database keeps no view or fixture:

```text
$ { echo 'begin;'; cat supabase/migrations/20261023150000_client_balances.sql supabase/tests/client_balances.sql; } | psql
ok 1 - invoice paid by 1,001 verified receipts owes nothing
ok 2 - drafts, cancelled invoices and unverified receipts are excluded
ok 3 - one row per client
ok 4 - invoice balance counts all 1,001 receipts
ok 5 - project time sums all 1,001 entries
ok 6 - non-members see no balances
ok 7 - non-members see no invoice balances or project time
ok 8 - anon cannot read balances
```

Before the migration the same test stops at `relation "client_balances" does not exist`. Before the select fix, `lib/record/change-stage-select.test.ts` failed with `expected 'lead' to be 'contacted'`. On the local API (read-only, service role), a `count: "exact"` read with `limit(1)` on a 4-row table returned one row and a count of 4. The deal page's inner-join quote read resolved with no ambiguity error, and its per-deal counts matched SQL. The Playwright smoke is still not run, for the reason above.

## Open issues

- Quotes have no `deal_id`, so a deal's Quotes button counts quotes on the deal's projects. A quote written before the project exists does not show. Adding `quotes.deal_id` would fix it and needs a migration.
- List pages take no record filters yet, so a button with several records opens the unfiltered list (or a section on the same page). Point these at filtered lists once the search-facets track adds URL filters.
- The two re-export files `quotes/_components/quote-status-badge.tsx` and `finance/_components/subscription-status-badge.tsx` remain because list pages and `ee/portal/page.tsx` import them. Delete them once those importers move to `@/components/status-badge`.
- `updateProjectStatus` and `updateDealStage` have no capability check and `updateProjectStatus` writes no audit entry. The status bar calls them as the old selects did, so this is unchanged, but worth a follow-up.
- Clients get breadcrumbs and smart buttons but no status bar, since there is no client status enum.
- Status-bar transitions are one click with no confirmation, including Mark lost and Cancel project. They were select-only before, and all of them can be reversed. Each button disables only itself while pending, so two quick clicks on different buttons can race. Quotes are protected by the compare-and-set in `setQuoteStatus`. Deals and projects keep the last write.
- Accept on a sent quote past its `valid_until` still shows and fails with "This quote has expired.", as it did before this change.
- Row cap, still open on these pages and older than this track: the project's billable value, its profit (billed invoices and costs) and its milestone done/total are still computed from list reads, so a project past 1,000 time entries, invoices, costs or milestones understates them. The dashboard's totals in `lib/queries/dashboard.ts` read the same way. Moving them needs the billable rounding (`Math.round` per entry) reproduced in SQL, which is why this round left them.
- The migration name was chosen by this track because the brief's name was unreadable. It sorts after `odoo-parity`'s latest migration (20261023130000), but check it against migrations other tracks add before merging.

## Review

An independent reviewer read the diff. It found one break, which is fixed: `e2e/tenant-onboarding.spec.ts` clicks "Activate" on a paused subscription, so the subscription flow keeps that word instead of "Resume". It found every new query org-scoped, no authority widened by the inline server actions, every quote transition the bar offers accepted by `quoteTransitionError`, and no status transition left unreachable. Its low findings are listed under open issues.
