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

GATES_PLACEHOLDER

## Review

An independent reviewer read the whole diff (`4bd97d0..HEAD`) and traced the unrunnable SQL by hand. Fixed from that review: three `crm.sql` expectations that kept a stale title, drops in the gap between cards landing at the bottom, same-column drops moving project cards, a per-column lock that could deadlock, the renumber touching a card that had just left the column, a departed deal owner failing a web-form submission, quotes created with only a project losing their deal link (seed included), an offline error in the reason dialog reaching the error boundary, a queued second Lost drop reusing the first dialog's choice (`key`), `authenticated` keeping default DELETE/TRUNCATE grants on `deal_lost_reasons`, the 6px activity-bar hit area, and quick create offered on Lost.

## Open issues

- Needs W4-c: deleting a deal sets `quotes.deal_id` to null, which fires `guard_quote_record`, and that guard rejects any update to an accepted quote past its valid-until date ("Quote expired"). Such a deal (and a client cascade through it) cannot be deleted. Worse, `deleteDeal` detaches the deal's activities before the delete, and that is not rolled back. Suggested fix in the guard: return early when `deal_id` is the only changed column. The non-atomic detach in `deleteDeal` predates this track.
- Changing a deal's client leaves its quotes linked to it; the next edit of such a quote fails "Deal and quote customer must match" until the deal field is cleared.
- Reordering bumps `updated_at` on the renumbered deals.
- A write that changes the stage and sets probability to exactly its old value gets the stage default (the trigger cannot tell "unchanged" from "re-typed"). The form always sends the new stage's default on a stage change, so this needs a deliberate re-type.
- No Playwright spec was added for the dialogs, drop slots or activity bar; they are covered by unit tests of the pure helpers and component logic only.
