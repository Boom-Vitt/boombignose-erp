# W4f record UX handover

2026-10-23. Branch `odoo-w4f-record-ux`, based on `4bd97d0` (`odoo-parity`). Adopts items 1, 4, 5, 7 and 9 of `odoo-js-flows/flows.md`. Front end and server actions only. No migration, and no SQL function is created or replaced.

## Changes

- **Item 1, save before acting and guard leaving.** `lib/record/guard.ts` is a small store: one lock per page for record actions, plus the header forms that may hold unsaved edits. `run(action)` refuses while another action runs, saves every dirty header form first, and does not run the action when a save fails. `components/record/record-guard.tsx` holds the tab's single instance and its hooks. The quote, invoice, deal and project header forms register through `useGuardedForm`, which returns their submit handler, resets the form to the values it sent after a successful save (edits typed during the save stay dirty), and refreshes the page inside a held transition. The form's own Save also holds the lock, so an action cannot save the same edits again meanwhile. Status-bar moves, Email quote, Email invoice and Convert quote run through the guard, so they save pending header edits first. Invoice issue is wrapped in `RequireSaved` and stays disabled with a visible message while the header is dirty, because it pins the saved invoice version and must not run on a version that a save is about to bump. Leaving with unsaved edits asks first. A `beforeunload` prompt covers reloads, closing the tab and other sites. A capture-phase click listener asks with `window.confirm` before an in-app link replaces the page, and lets same-page anchors, new tabs and downloads through.
- **Item 4, lock the bar and confirm destructive moves.** `StatusBar` renders its actions inside a `<fieldset disabled>` driven by the guard, so every action in the bar (and Email and Convert) is disabled while one move runs. The guard state is read with `useSyncExternalStore`, so the lock renders at once even inside a React transition. Each action runs in a transition whose pending state holds the lock until the `router.refresh()` it started has rendered, so the bar never offers moves for the status it just left. `FlowAction` gains optional `confirm` and `reason`. Mark lost, Decline, Cancel project, Cancel subscription and Cancel purchase order open an `AlertDialog` first. Mark lost and Decline also take an optional reason, logged as a record note (`Lost: …`, `Declined: …`) after the move succeeds, through the existing `logRecordNote`. `StatusBar` takes an optional `record` prop for this. The quote and deal pages pass it.
- **Item 5, no capped lists.** The quotes list and the clients list read through `readAll` with a total order, so the list, group counts and group sums cover every row. Timesheets was left alone at the coordinator's request (W4-d owns it this wave).
- **Item 7, several values per facet.** `status` may hold a comma list (`status=draft,sent`) that matches any of its values; groups still AND. `parseFacets` keeps only the list's known statuses, once each, in the list's own order, and still rejects a repeated key. `FacetConfig.status` stays a string, so saved views (validated as `z.string()` and re-parsed through `parseFacets`) load unchanged, old and new. `facetValues()` splits the value. In the filter panel a status click toggles that value. The chips show one chip per group: a single status keeps its old label (`Sent`), several read `Draft or Sent`, and removing the chip clears the group. Period stays single-valued (coordinator decision).
- **Item 9, fuller activities.** `completeRecordActivity` accepts the old plain id or `{ id, feedback?, next? }`. The note is appended to the activity body in the same update that marks it done, so the timeline line carries it. The update is guarded by `done = false` with `.select()`, so a double click or a stale page gets "already completed or removed" and schedules nothing. A next activity's assignee is checked before completing, and the next activity lands on the same record with an audit entry. New `updateRecordActivity` and `cancelRecordActivity` act only on open activities in the active org, check the affected row and write `activity_updated` and `activity_cancelled` audits. The planned list offers Mark done (dialog with note and an optional next activity), Edit and Cancel. `ActivityFields` is shared by the composer and both dialogs. The timeline no longer remounts on every refresh. It is keyed by the record, and `mergeLoaded` keeps older pages already loaded while they stay contiguous with the fresh first page, and drops them when a gap would show.

## Files

- Item 1 and 4: `lib/record/guard.ts`, `lib/record/status.ts`, `components/record/record-guard.tsx`, `components/record/status-bar.tsx`, `components/record/transition-button.tsx`; header forms `app/(app)/quotes/_components/quote-form.tsx`, `app/(app)/finance/_components/invoice-form.tsx`, `app/(app)/deals/_components/deal-form.tsx`, `app/(app)/projects/_components/project-form.tsx`; buttons `app/(app)/quotes/_components/email-quote-button.tsx`, `app/(app)/finance/_components/email-invoice-button.tsx`, `app/(app)/quotes/_components/convert-quote-button.tsx` (a two-line wrap; the conversion body is byte-identical); pages `app/(app)/quotes/[id]/page.tsx` and `app/(app)/deals/[id]/page.tsx` (one `record` prop each), `app/(app)/finance/invoices/[id]/page.tsx` (`RequireSaved` around `IssueInvoiceForm`, issue code untouched).
- Item 5 and 7: `lib/search-facets.ts`, `components/search/search-facets.tsx`, `app/(app)/quotes/page.tsx`. Outside ownership, each in its own commit and approved by the coordinator: `app/(app)/clients/page.tsx` (readAll), `app/(app)/deals/page.tsx` and `app/(app)/projects/page.tsx` (one board-columns line each), `app/(app)/finance/invoices/export/route.ts` (comma list).
- Item 9: `lib/record-history/{actions,input,timeline}.ts`, `components/record/{record-history,activity-timeline,activity-done,activity-composer}.tsx`, new `components/record/{activity-fields,activity-edit,activity-cancel}.tsx`.
- Tests: `lib/record/{guard,leave-guard,save-first,status-bar,transition-button}.test.ts` (new), `lib/record/status.test.ts`, `lib/search-facets{,-ui}.test.ts`, `lib/queries/{quotes-facets,finance-invoice-export}.test.ts` (new), `lib/queries/{clients-facets,deals-projects-facets,saved-views,saved-view-actions}.test.ts`, `lib/record-history/{actions,input,timeline}.test.ts`, `lib/record-history/planned-activities-ui.test.ts` (new). `lib/workflows/service-controls.test.ts` gains two hook mocks because Convert now reads the guard.

## Verification

Every behavior got its Vitest test first and was seen failing before the change, except the leave-prompt and `RequireSaved` tests, which were written after the code and then proven by a mutation run (removing `discard()`, `stopPropagation()` and the dirty check made three of them fail). The app was not run in a browser: Supabase and Docker are off limits here, so the dialogs, the leave prompt and the save-first flow are verified by unit tests only.

```
$ pnpm lint
$ eslint
(exit 0, no output)

$ pnpm typecheck
$ tsc --noEmit
(exit 0, no output)

$ pnpm test
 Test Files  127 passed (127)
      Tests  948 passed (948)

$ pnpm build
✓ Compiled successfully in 4.6s
  Finished TypeScript in 6.3s ...
ƒ  (Dynamic)  server-rendered on demand
(exit 0)
```

## Review round

An independent reviewer read the item 1 and 4 diff. It found nothing that leaves the lock stuck, and five issues that are now fixed in `80c5779`, each covered by the guard tests or the existing ones:
- Edits typed while a save was in flight were marked clean. The form now resets to the values it sent.
- The lock released before the refreshed page arrived, so Decline could be confirmed twice and log the reason twice. The lock now holds until the refresh renders.
- A failed status move became an unhandled rejection. Actions run inside a transition again, so errors reach the error boundary as before.
- A header save could run twice when an action was clicked during the form's own Save. The form's Save now holds the lock.
- Issue could re-enable before the new invoice version arrived after a header save. The post-save refresh is held, so `RequireSaved` waits for it.

The items 5, 7 and 9 work was written by delegates in separate worktrees and reviewed by me before it was cherry-picked. One fix came from that review: `aria-pressed` was removed from the filter links, where it is not an allowed attribute.

## Open issues

- The browser back and forward buttons do not ask before leaving a dirty record. App Router exposes no way to block a history navigation, so only links, reloads and tab closes are covered.
- The leave prompt is the native `window.confirm`, matching the browser's own `beforeunload` prompt. It offers leave or stay, not "save and leave".
- Controls this track may not change keep their own pending state and do not take the page lock: the deal page's `ChangeStageSelect` (W4-e), `IssueInvoiceForm` and the payment forms (W4-a), and status-bar commands on purchases and expenses. Invoice issue is still disabled while a guarded action runs, through `RequireSaved`, and the purchase and expense commands sit inside the status bar fieldset. `ChangeStageSelect` and the payment forms are not locked.
- A reason for Lost or Declined is a separate note written after the move. If the note fails the user is told to add it by hand. Storing the reason with the status change would need the transition actions (W4-c, W4-e) or a column.
- Completing with a note reads the body and then updates it. An edit landing in between is overwritten by the old body plus the note.
- Links inside the status bar (Receive, Create bill, `#issue-invoice`) stay clickable while the bar is locked, because a disabled fieldset does not disable links. They only navigate.
- `IssueInvoiceForm` keeps its request key in a ref across a header save that bumps the invoice version (unchanged by this track, W4-a's file). Adding `key={invoice.version}` where the page renders it would give each version its own key.
- Timesheets still reads time entries and projects without paging (left to W4-d).
- `serializeFacets` encodes the comma, so URLs read `status=draft%2Csent`. Both forms parse the same.

## SQL functions

None created or replaced.
