# Odoo parity t1: record header

Branch `odoo-t1-record-header`, based on `main` at b4d9d69. No data or migration changes.

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
 Test Files  72 passed (72)
      Tests  554 passed (554)

$ pnpm build
ƒ  (Dynamic)  server-rendered on demand
(exit 0)
```

`lib/record/status.test.ts` (34 tests) checks that every flow covers every value of its enum, that declined, lost and cancelled never appear as chevrons and render as a badge, that no action targets the record's own status, the done, current and upcoming step states, that an overdue invoice sits on Sent with a badge, that unavailable actions drop without promoting a secondary, that every quote transition passes `quoteTransitionError`, and the brief's tone mapping.

The Playwright smoke `e2e/record-header.spec.ts` was written but not run, because it needs the Supabase stack and this track may not start it. It opens QUO-2026-001 and INV-2026-001 from their lists and asserts the breadcrumb root link, a status list with exactly one current step, and a Project smart button. Both seeded records link to a project. The coordinator runs it on the integration stack.

The new components were rendered to static HTML with the production CSS and screenshotted with Chromium at 1280, 700 and 390 px. Chevrons, side badges and the phone layout render as intended with no horizontal page overflow. The full pages were not seen in a browser because they need the database.

## Open issues

- Quotes have no `deal_id`, so a deal's Quotes button counts quotes on the deal's projects. A quote written before the project exists does not show. Adding `quotes.deal_id` would fix it and needs a migration.
- List pages take no record filters yet, so a button with several records opens the unfiltered list (or a section on the same page). Point these at filtered lists once the search-facets track adds URL filters.
- The two re-export files `quotes/_components/quote-status-badge.tsx` and `finance/_components/subscription-status-badge.tsx` remain because list pages and `ee/portal/page.tsx` import them. Delete them once those importers move to `@/components/status-badge`.
- `updateProjectStatus` and `updateDealStage` have no capability check and `updateProjectStatus` writes no audit entry. The status bar calls them as the old selects did, so this is unchanged, but worth a follow-up.
- Clients get breadcrumbs and smart buttons but no status bar, since there is no client status enum.
- Status-bar transitions are one click with no confirmation, including Mark lost and Cancel project. They were select-only before, and all of them can be reversed. Each button disables only itself while pending, so two quick clicks on different buttons can race. Quotes are protected by the compare-and-set in `setQuoteStatus`. Deals and projects keep the last write.
- Accept on a sent quote past its `valid_until` still shows and fails with "This quote has expired.", as it did before this change.
- The client open balance passes invoice ids in the request URL (marked `shortcut:` in the page). A client with several hundred invoices would fail that read and hide the balance rather than show a wrong one.

## Review

An independent reviewer read the diff. It found one break, which is fixed: `e2e/tenant-onboarding.spec.ts` clicks "Activate" on a paused subscription, so the subscription flow keeps that word instead of "Resume". It found every new query org-scoped, no authority widened by the inline server actions, every quote transition the bar offers accepted by `quoteTransitionError`, and no status transition left unreachable. Its low findings are listed under open issues.
