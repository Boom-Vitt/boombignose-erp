# Odoo parity t3: kanban boards for deals and projects

## What changed

**Overflow bug.** At 1440x900 the deals page measured 1696px wide. `SidebarInset` (the `<main>` in `app/(app)/layout.tsx`) is a flex item in the sidebar wrapper row, so it kept `min-width: auto`. The board's `min-w-max` row raised its min-content width, which pinned `<main>` at its `w-full` 1440px beside the 256px sidebar gap: 1440 + 256 = 1696. Adding `min-w-0` to `SidebarInset` lets the content area shrink and the board scroll inside its own container. This was reproduced with the repo's compiled Tailwind CSS in headless Chromium: 1696px before, 1440px after, with New deal and Export CSV back on screen.

**Shared kanban.** `lib/kanban.ts` holds the pure logic: `groupCards` (column buckets, counts, satang sums via `sumSatang`), `moveCard` (the optimistic stage move), `dueState`, `earliestDate`, `initials`, `parseFolded`. `components/kanban/kanban-board.tsx` renders the board. Each column header shows the stage name, record count, sum formatted with `formatTHBWhole`, a "+" quick create and a fold button. Folded columns become a narrow vertical strip that still accepts drops. Cards show title, amount, client, owner initials and a due-state dot for the next activity. Each card has a "Move to…" menu for keyboard and touch users.

**Drag and drop.** Native HTML5 drag and drop, no new dependency. A move runs inside a transition with `useOptimistic`. The card shows in its new column immediately. The existing server actions call `revalidatePath`, so the refreshed list arrives in the same transition. When the action returns an error or throws, React drops the optimistic layer, the card returns to the server's column, and a toast shows the error.

**Fold state.** Stored per user under `kanban:<module>:<userId>` in localStorage through `useSyncExternalStore`. Server and hydration render the default folds, so there is no hydration mismatch. Every storage access is in try/catch, with an in-memory copy so folding still works when storage throws.

**Quick create.** The "+" card takes a title and amount (deals also need a client, since `deals.client_id` is NOT NULL). Add creates the record in that column and keeps the card open for the next one. Edit opens the full form prefilled through query params. New actions `quickCreateDeal` and `quickCreateProject` reuse the existing Zod schemas (`.pick`) and share the insert with `createDeal` / `createProject`, which now call `insertDeal` / `insertProject`. Deal creation keeps its audit entry. Project creation had no audit entry before and still has none.

**Deals.** The board uses `deal_stage` columns. Won and Lost are folded by default. A stage filter shows the single column unfolded. The next-activity dot uses the earliest of the deal's follow-up date and its open activities' due dates. The activity date comes from the `deal_next_activity` view (see fix round 1).

**Projects.** A List | Board switcher (`?view=board`) sits next to New project. List stays the default. Board columns follow `project_status` in the list's order. Cancelled is folded by default. The dot uses the deadline, except for delivered and cancelled projects.

## Fix round 1 (Codex review)

The branch was fast-forwarded to `odoo-parity` (924d3d7) first, so the fixes build on the record-history schema.

**Next-activity dots.** The page used to read open activities as a plain list, which the API caps at 1,000 rows, so a deal's earliest activity could be missing. The review reproduced it: 1,000 activities on deal A pushed deal B's overdue activity out, and B showed its future follow-up date instead. Migration `20261023140000_deal_next_activity.sql` adds `public.deal_next_activity (org_id, deal_id, next_due_date, open_count)`, a `security_invoker` view that groups open activities by deal in the database. It keeps activities RLS, is revoked from `anon` and granted to `authenticated`. Record history's sync trigger copies `record_type='deal'` links into `deal_id`, so grouping by `deal_id` covers legacy and polymorphic activities. The SQL test inserts one polymorphic activity to prove it. The page reads the view through `readAll`.

**Complete board lists.** Column counts and sums (and the deals KPIs) were computed from deal and project lists capped at 1,000 rows. New `lib/supabase/read-all.ts` reads a list page by page until a short page. It needs a unique order, so both queries gain `.order("id")` as a tiebreak. If any page fails, it returns no rows, which keeps the pages' existing empty-on-error behavior and never shows a partial total.

**Focus after a rejected keyboard move.** The board cleared its focus target right after the optimistic render. When the action failed, React dropped the optimistic layer and remounted the card in its old column, leaving focus on the page body. The board now follows the moved card until its transition settles (`isPending` from `useTransition` flips in the same commit that drops the optimistic layer). `movedCardFocus` in `lib/kanban.ts` decides each render: focus the card's Move button, or its column's strip when folded, only when focus fell to the body, and stop following once the move settles. A Tab away during the move is left alone.

**Project status audit.** No app change. In `odoo-parity`, `20261023120000_record_history.sql` adds the `log_record_status` trigger on `projects`, which writes a `record_status_changed` audit entry with from and to for every status change, including board moves through `updateProjectStatus`. Adding `writeAudit` in the action would log every move twice. The SQL test asserts that a member's board move writes exactly one entry.

## Files

- `app/(app)/layout.tsx` adds `min-w-0` on `SidebarInset` (one line plus a comment).
- `lib/kanban.ts`, `lib/kanban.test.ts` are new.
- `components/kanban/kanban-board.tsx`, `kanban-card.tsx`, `use-folded-columns.ts` are new.
- `app/(app)/deals/page.tsx` replaces the inline board. `_components/deals-board.tsx` is new.
- `app/(app)/deals/actions.ts` adds `quickCreateDeal`. `new/page.tsx` reads `title`, `amount`, `stage`, `clientId`.
- `app/(app)/projects/page.tsx` adds the switcher and board. `_components/projects-board.tsx` is new.
- `app/(app)/projects/actions.ts` adds `quickCreateProject`. `new/page.tsx` reads `name`, `budget`, `status`.
- `lib/supabase/active-org-pages.test.ts`, `lib/workflows/service-pages.test.ts` pass the new `searchParams` props, and the latter adds a board case to the org-scoping check.
- `e2e/kanban.spec.ts` is new.
- Fix round 1: `supabase/migrations/20261023140000_deal_next_activity.sql`, `supabase/tests/deal_next_activity.sql`, `lib/supabase/read-all.ts` and its test are new. `lib/types/database.ts` adds the view type. `lib/kanban.ts` adds `movedCardFocus`. `components/kanban/kanban-board.tsx`, `app/(app)/deals/page.tsx`, `app/(app)/projects/page.tsx` change. `lib/supabase/__tests__/tenant-fixture.ts` now applies `range` and the 1,000-row cap like PostgREST, and `lib/workflows/service-pages.test.ts` stubs `range`.

The coordinator approved the edits outside the original ownership list (actions, new pages, layout).

## Verification

**Gates.** All four pass on the final tree. The final lines of each:

```
$ pnpm lint
$ eslint
$ pnpm typecheck
$ tsc --noEmit
$ pnpm test
 Test Files  72 passed (72)
      Tests  531 passed (531)
$ pnpm build
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

Lint and typecheck print nothing after the command line when clean. The new unit tests in `lib/kanban.test.ts` cover column grouping and satang sums (including the unsafe-sum guard), the optimistic move, rollback (the server list is never mutated, so dropping the optimistic layer restores the original columns and sums), the no-op cases, due state, earliest date, initials (Thai leading vowels) and fold parsing.

**Review.** A separate Opus reviewer audited the branch diff and found no high-severity defects. Its three findings were fixed and re-verified. (1) Keyboard focus fell to the page body after Move, fold/unfold and closing quick create. Focus now follows the moved card (or its folded column), swaps between the fold and unfold buttons, and returns to "+". (2) Fold state in one tab could overwrite another tab's change. The in-memory copy is now used only when storage refuses a write. (3) The open-activities query could exceed PostgREST's 1000-row cap. It now skips rows without a deal or due date and orders by due date, so a capped response keeps the earliest dates.

**Browser check of the component.** A throwaway Vite harness rendered `KanbanBoard` in a copy of the app layout with the compiled CSS. A Playwright script then passed 29 of 29 checks at 1440x900 and 390px, on two consecutive runs. The checks cover page scrollWidth (1440 and 390), board-internal scroll, header count and sum, due dot and initials, the optimistic drag, the rollback with its error toast, the keyboard "Move to…" menu with focus following the card, focus after fold and unfold, a drop onto a folded column, fold persistence across reloads and across tabs, folding with throwing localStorage, quick create (values and extra fields) and the prefilled Edit link. The harness was deleted afterwards and is not committed.

**Playwright e2e.** `e2e/kanban.spec.ts` asserts `document.documentElement.scrollWidth <= 1440` on /deals at 1440x900, that New deal and Export CSV are in the viewport, that Won starts folded, and that the projects board renders. It needs the local Supabase stack, which was not started here (shared machine rule). The coordinator runs it on the integration stack.

**Fix round 1 checks.** Lint, typecheck, `pnpm test` (91 files, 657 tests) and build pass. Each new test failed first on the old code. The deals page test (1,000 busy deals ahead of an overdue one) showed `2026-12-31`, the follow-up date, instead of `2026-01-15`. The board test with 1,001 deals and 1,001 projects lost the last record of each. `movedCardFocus` did not exist. A throwaway Vite harness (scratchpad, not committed) rendered the old and new `KanbanBoard` in headless Chromium and drove the keyboard Move to… menu. After a rejected move the old board left focus on `body`. The new one returned it to card a's Move button in Lead. Success kept focus on the card in its new column, and focus moved elsewhere during the move stayed there, on both versions. The pgTAP file `supabase/tests/deal_next_activity.sql` was not run here, because the coordinator asked not to start containers or read their stack. The coordinator runs it at merge.

## Open issues

- Dragging to a column outside the visible board area relies on the browser's edge auto-scroll during a drag. The "Move to…" menu always works.
- Quick-created projects have no client. The Edit link opens the full form when a client is needed.
- A keyboard move into a folded column puts focus on that column's strip. If the move is rejected, focus stays on the strip rather than returning to the card, because focus was not lost. The error toast still announces the failure.
- The deals page's client list (names on cards and the quick-create picker) is still a single capped read. Past 1,000 clients some cards show no client name. It is not a total, so it was left as is.
- The column header has no activity progress bar and there is no "+ Stage" column (Odoo has both). Stages are enums here.
