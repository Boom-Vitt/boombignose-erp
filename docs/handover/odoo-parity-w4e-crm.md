# Wave 4e CRM handover

Sales users can now say why a deal was lost, see when it was won or lost, weigh each deal by its own win probability, and keep the board in the order they arrange it. Marking a deal lost always asks for a reason: the deal page's Mark lost button, the Change stage select, a drop on the Lost column and the deal form all collect one. Owners and admins edit the reason list at `/deals/lost-reasons` (archive, never delete). Probability defaults from the stage and is editable on the form; expected revenue (value × probability) shows on every card's column, in the list view, in the Expected revenue headline, on the dashboard's weighted pipeline and in the CSV export. Quotes link to a deal, the deal page's Quotes button counts them (and offers a new linked quote in proposal and negotiation), and an accepted quote whose deal is still open offers one-click Mark deal won. A repeat web-form enquiry from a known email lands on that client's newest open deal as a note plus a follow-up activity for today, instead of opening a duplicate deal.

## Data and invariants

- `supabase/migrations/20261025120000_crm.sql` adds `deal_lost_reasons` (org-scoped, RLS enabled and forced: members read, staff insert and update; unique name per org ignoring case; seeded with five defaults for every existing org and, by an `organizations` insert trigger, for new ones).
- `deals` gains `probability` (0 to 100, not null), `lost_reason_id` (tenant FK), `won_at`, `lost_at` and `sequence`. Backfill: stage-default probability, won/lost dates from the latest `stage_changed` audit entry or `updated_at`, and `sequence` in today's board order (newest first). `set_updated_at` is off during the backfill so `updated_at` keeps its meaning.
- `private.apply_deal_stage` (before insert or update on deals) is the single owner of stage-derived fields on every write path. A stage change resets probability to the stage default unless the same write changes it; won pins 100 and lost pins 0; `won_at`/`lost_at` are set on entering the closed stage and cleared on leaving it; entering lost (or changing the reason) needs an active reason, else `23514 Pick a lost reason`; leaving lost clears the reason; a deal entering a column goes to its top unless the same write sets `sequence`. `private.deal_stage_probability` mirrors `STAGE_PROBABILITY` in `lib/metrics/pipeline.ts`.
- `public.move_deal(org, deal, stage, after, lost_reason)` (security invoker, so deals RLS applies) is the board's move. It takes one advisory lock per workspace board (per-column locks deadlock when two cards swap columns), places the deal right after `after` (top when null or when that card has left the column), renumbers the column densely, and raises `P0002 Deal not found` when the deal is gone. `updateDealStage` now calls it and returns an error instead of "Moved" when no row exists.
- `quotes.deal_id` (tenant FK, on delete set null) with `private.guard_quote_deal` requiring the deal's client to equal the quote's client. A new quote created with only a project takes that project's deal (insert only, so clearing the Deal field on edit sticks); this also links the seed quotes. Existing quotes are backfilled from their project's deal where the clients match, with `guard_quote_record` and `set_updated_at` off for that statement only.
- `public.submit_lead_form` is redefined (same signature and grants). The follow-up goes to the deal owner while they are still a member, else to the form's default owner, so a departed owner cannot make a public submission fail. The audit entry says whether the enquiry was attached (`meta.attached`).
- `supabase/seed.sql` now gives its lost demo deal the "Not a fit" reason, since a lost deal without one is refused.
- Mark lost became a status-bar command (`lose` in `FlowCommand`), so the command palette no longer offers a reason-less Mark lost.

SQL functions created or replaced by this track: `private.seed_deal_lost_reasons`, `private.deal_stage_probability`, `private.apply_deal_stage`, `public.move_deal`, `private.guard_quote_deal`, `public.submit_lead_form` (replaced). No quote, invoice or time-entry function was touched.

## Board

- `components/kanban/kanban-board.tsx` takes `reorderable` (deals on, projects off, so the projects board behaves as before, including ignoring same-column drops). A drop lands before the first card whose middle is below the pointer, so the gaps between cards work too; a line drawn in the gap (no layout shift) shows the slot; cards also have Move up and Move down in their menu. Moves go through one `serialQueue`, so a move waits for the previous one and each lands in the order made. A move can resolve `{ cancelled: true }` (the Lost dialog closed) and is then dropped silently.
- Each column shows `Expected ฿…` when its cards carry a probability, and a segmented bar of overdue, today and planned next activities. A segment is a toggle button that filters the column; the active one stays even at zero so it can be cleared.
- `quickCreate.canCreateIn` hides quick create per column; the deals board hides it on Lost, which needs a reason first.
- Quick create: Escape on a card that holds typed text shows "Discard what you typed?" with Keep editing focused; Escape again keeps editing. Escape inside the client select popup only closes the popup.
- Pure helpers in `lib/kanban.ts`: `moveCard(cards, id, to, after)`, `afterForDrop`, `reorderAfter`, `serialQueue`, `activityCounts`, `activityState`, `hasTypedInput`, and `expectedSatang` on each group.

## Files

Owned: the migration, `supabase/tests/crm.sql`, `supabase/tests/lead_forms.sql`, `app/(app)/deals/**` (new: `_components/lost-reason-dialog.tsx`, `deal-won-offer.tsx`, `mark-won-button.tsx`, `_lib/deal-options.ts`, `lost-reasons/`), `components/kanban/**`, `lib/kanban.ts`, `lib/metrics/pipeline.ts`, new tests in `lib/deals/`.

Additive edits outside ownership, approved by the coordinator: `app/(app)/quotes/actions.ts` (`deal_id` in `CreateQuote`/`UpdateQuote` and their payloads), `quote-form.tsx` (Deal field filtered by client), `quotes/new/page.tsx` (deal options, `?dealId` prefill), `quotes/[id]/page.tsx` (`deal_id` in the select, deal options, one `<DealWonOffer>` line). Other small shared edits: `lib/record/status.ts` (`lose` command), `lib/queries/dashboard.ts` (selects `probability`), `lib/types/database.ts`, `supabase/seed.sql`, and test fixtures that build deal rows or mock the quote pages (`active-org-pages`, `deals-projects-facets`, `seed-id-actions`, `service-pages`, `record-actions`, `change-stage-select`).

## Verification

Each change has a test that failed before and passes after. Vitest: `lib/metrics/pipeline.test.ts` (3 failing first), `lib/kanban.test.ts` (10, then 1 more for self-hover drops), `lib/record/status.test.ts` (lost is a command), `lib/deals/actions.test.ts` (all 7 fail against the previous `actions.ts`), `lib/record/change-stage-select.test.ts` (3 fail against the previous component), `lib/deals/quote-link.test.ts` (the deal_id save fails against the previous quote actions). SQL: `supabase/tests/crm.sql` (39 assertions) and the updated `lead_forms.sql` (49) were written against the migration but not executed, because Supabase and Docker are off limits on this machine. The coordinator's integration database is their first run.

Gates ran on 2026-10-23 in this worktree after merging `odoo-parity` at `c5348bc`, and all four exited 0:

```text
pnpm lint
$ eslint                                  (exit 0)

pnpm typecheck
$ tsc --noEmit                            (exit 0)

pnpm test
 Test Files  141 passed (141)
      Tests  1071 passed (1071)

pnpm build
✓ Compiled successfully in 3.6s
├ ƒ /deals
├ ƒ /deals/[id]
├ ƒ /deals/[id]/edit
├ ƒ /deals/export
├ ƒ /deals/lost-reasons
├ ƒ /deals/new
```

`e2e/web-to-lead.spec.ts` was hardened as the coordinator asked: after the card click it now waits for the deal URL and the deal's h1 before checking the source. The spec type-checks but was not run, because e2e needs the local Supabase stack.

## Review

An independent reviewer read the whole diff (`4bd97d0..HEAD`) and traced the unrunnable SQL by hand. Fixed from that review: three `crm.sql` expectations that kept a stale title, drops in the gap between cards landing at the bottom, same-column drops moving project cards, a per-column lock that could deadlock, the renumber touching a card that had just left the column, a departed deal owner failing a web-form submission, quotes created with only a project losing their deal link (seed included), an offline error in the reason dialog reaching the error boundary, a queued second Lost drop reusing the first dialog's choice (`key`), `authenticated` keeping default DELETE/TRUNCATE grants on `deal_lost_reasons`, the 6px activity-bar hit area, and quick create offered on Lost.

## Merge with odoo-parity

W4-f had turned Mark lost into a confirm dialog with a free-text reason kept as a record note. Under this track a move to lost without a lost reason is refused by the database, so Mark lost stays this track's `lose` command. The reason dialog now also takes W4-f's optional note, which is saved as "Lost: …" in the record history from all three entry points: status bar, stage select and board. The status-bar Mark lost runs under W4-f's record guard, so the whole bar locks while it is pending. W4-f's `status-bar.test.ts` gives the bar a `lose` handler so Mark lost still renders there. Every form here has a submit control, so the new `forms-submit` guard passes.

## Fix round 1 (Codex review `reviews/w4e.md`)

Branch merged `odoo-parity` at `87851f8` first (clean). All six findings are fixed in `supabase/migrations/20261025160000_crm_fixes.sql` plus small action changes, with the failing tests committed first (`ba1c5e3`) and the fixes on top (`9af2f6a`).

- **Atomic deal delete.** New `public.delete_deal(org, deal)` (security invoker, deals RLS applies) locks the deal, moves its activities to the client, deletes it and returns the title, all in one transaction. `deleteDeal` calls it instead of two separate writes, and a deal that is already gone now returns the "no longer exists" error instead of auditing a phantom delete. With W4-a's link-only exemption in `guard_quote_record`, a deal whose accepted quote is past its valid-until date now deletes; the quote stays accepted with its content unchanged and loses only `deal_id`.
- **Quote and deal customer match from both sides.** `quotes_deal_tenant_fkey (org_id,deal_id)` is replaced by `quotes_deal_client_fkey (org_id,deal_id,client_id) -> deals(org_id,id,client_id) on delete set null (deal_id)`, backed by a new unique key `deals_org_id_id_client_id_key`. Changing the client of a deal that has quotes is refused (23503), and `updateDeal` turns that into "This deal has quotes for its current client. Unlink them before changing the client." Quotes already sitting on another customer's deal are unlinked by the migration, with `guard_quote_record` and `set_updated_at` off for that link-only statement as in the original backfill. `guard_quote_deal` still gives the friendly quote-side message. `deal-won-offer.tsx` now embeds through the new constraint name, and `lib/types/database.ts` lists it, so typecheck catches a stale embed hint.
- **Web-form deal lock.** `submit_lead_form` selects the reused open deal `for update` and keeps the lock until commit (only that line changed). A deal closed concurrently fails the recheck, so the enquiry goes to the next open deal or a new one.
- **Explicit probability.** A column-list trigger `apply_deal_probability_flag` (`before update of probability`, sorts before `apply_deal_stage`) flags the row in a transaction-local setting (`crm.deal_probability_named`); `apply_deal_stage` resets probability on a stage change only when the write did not name it, and clears the flag on every update. An explicit value equal to the old one now survives; an explicit null takes the stage default.
- **Exact expected revenue.** `expectedRevenue` multiplies and rounds half up in `BigInt`, so `9007199254740991 x 30%` gives `2702159776422297`. The deal form's live preview rounds a typed decimal probability before calling it.
- **Lost note in the same transaction.** `move_deal` gains `p_note` (dropped and recreated, grants re-issued). `updateDealStage` passes `Lost: <note>` for lost moves, so a note that cannot be saved fails the whole move and the board, select and status bar never disagree with the database. `logRecordNote` is no longer called from deal actions.

SQL functions created or replaced in this round: `public.delete_deal` (new), `private.flag_deal_probability` (new), `private.apply_deal_stage` (replaced), `public.move_deal` (dropped and recreated with `p_note`), `public.submit_lead_form` (replaced). No W4-a function (`guard_quote_record`, `guard_commercial_customer`) or W4-c quote function was redefined; the migration only disables and re-enables `guard_quote_record` around the one repair statement.

### Verification, fix round 1

Failing first. `supabase/tests/crm_fixes.sql` (22 assertions) against the pre-fix schema: the two new RPCs did not exist; with those lines stripped, the client change succeeded (wanted 23503), an explicit 40% became 50%, and the reused deal held only `{"For Key Share"}`. Vitest: 6 new assertions failed before the fix (`lib/deals/actions.test.ts`, `lib/metrics/pipeline.test.ts` got `2702159776422298`), and the review-found form crash failed with `RangeError: The number 33.5 cannot be converted to a BigInt` (`lib/deals/deal-form.test.ts`).

Runtime checks on the isolated stack:
- Two sessions, one closing the deal while the other submits a repeat enquiry. Old function: no wait, enquiry on "Open deal (won)". New function: waited 1.5 s for the close, then opened "Web form: Race visitor (lead)".
- Repair statement on a database seeded with one mismatched link: 1 mismatch before, 0 after, the valid seed link kept.
- A temporary Playwright spec (not committed; it needs `docker exec` to fake an expired acceptance) deleted a deal with an expired accepted quote through the edit page's Delete button: deal gone, quote `accepted` and unlinked, activity on the client, audit "Deleted deal ...".
- PostgREST: the old embed hint `deals!quotes_deal_tenant_fkey` returns `PGRST200` after the migration; the new hint resolves.

Gates on the final commit (`9af2f6a`), all on the exclusive stack (API 55901, app 3108):

```text
.local-stack/db-reset.sh "$PWD"
Files=33, Tests=1047
Result: PASS

pnpm lint
$ eslint                                  (exit 0)

pnpm typecheck
$ tsc --noEmit                            (exit 0)

pnpm test
 Test Files  149 passed (149)
      Tests  1181 passed (1181)

pnpm build
✓ Compiled successfully in 3.8s

pnpm e2e
  1 failed
    [chromium] › e2e/v2.spec.ts:18:5 › invoices CSV exports amounts in baht, not satang
  4 skipped
  45 passed (1.5m)
$ pnpm e2e e2e/v2.spec.ts
  5 passed (2.7s)
```

An independent reviewer read the round's diff. It confirmed all six fixes and found three regressions in this round's own change, all fixed before the gates above: the won offer's embed hint named the dropped constraint, the form preview crashed on a decimal probability, and the repair statement could abort the migration on a legacy quote whose project client also differed.

## Open issues

- Reordering bumps `updated_at` on the renumbered deals.
- Changing a quoted deal's client is refused. The user must unlink the quotes first; there is no "move quotes with the deal" option.
- `delete_deal` moves activities to the client but leaves the deal's record notes and attachments without a parent record (unchanged from before this round).
- No Playwright spec was added for the dialogs, drop slots or activity bar; they are covered by unit tests of the pure helpers and component logic only. The expired-quote delete was checked live but is not a committed spec, because no API path can produce an accepted quote past its valid-until date.
- Full `pnpm e2e` drops one test per run on this stack, a different one each time: `time-metrics.spec.ts:16`, `v2-batch2.spec.ts:70` (twice) and `v2.spec.ts:18` in four runs on this branch. Each of those failures sits on the sign-in page (redirected back to `/login`) while GoTrue logs `Session not found` for `/user`, and each spec passes when run alone. None touches code changed here. The `odoo-parity` baseline (`87851f8`), built and run the same way, also failed one test (`time-metrics.spec.ts:16`, 30 s timeout; 45 passed), so this predates the round. Suspected cause, not verified: session churn between specs under refresh-token rotation (`refresh_token_reuse_interval = 10`). Owner: whoever owns the shared e2e auth helpers.