# Odoo parity t3: kanban boards for deals and projects

## What changed

**Overflow bug.** At 1440x900 the deals page measured 1696px wide. `SidebarInset` (the `<main>` in `app/(app)/layout.tsx`) is a flex item in the sidebar wrapper row, so it kept `min-width: auto`. The board's `min-w-max` row raised its min-content width, which pinned `<main>` at its `w-full` 1440px beside the 256px sidebar gap: 1440 + 256 = 1696. Adding `min-w-0` to `SidebarInset` lets the content area shrink and the board scroll inside its own container. This was reproduced with the repo's compiled Tailwind CSS in headless Chromium: 1696px before, 1440px after, with New deal and Export CSV back on screen.

**Shared kanban.** `lib/kanban.ts` holds the pure logic: `groupCards` (column buckets, counts, satang sums via `sumSatang`), `moveCard` (the optimistic stage move), `dueState`, `earliestDate`, `initials`, `parseFolded`. `components/kanban/kanban-board.tsx` renders the board. Each column header shows the stage name, record count, sum formatted with `formatTHBWhole`, a "+" quick create and a fold button. Folded columns become a narrow vertical strip that still accepts drops. Cards show title, amount, client, owner initials and a due-state dot for the next activity. Each card has a "Move to…" menu for keyboard and touch users.

**Drag and drop.** Native HTML5 drag and drop, no new dependency. A move runs inside a transition with `useOptimistic`. The card shows in its new column immediately. The existing server actions call `revalidatePath`, so the refreshed list arrives in the same transition. When the action returns an error or throws, React drops the optimistic layer, the card returns to the server's column, and a toast shows the error.

**Fold state.** Stored per user under `kanban:<module>:<userId>` in localStorage through `useSyncExternalStore`. Server and hydration render the default folds, so there is no hydration mismatch. Every storage access is in try/catch, with an in-memory copy so folding still works when storage throws.

**Quick create.** The "+" card takes a title and amount (deals also need a client, since `deals.client_id` is NOT NULL). Add creates the record in that column and keeps the card open for the next one. Edit opens the full form prefilled through query params. New actions `quickCreateDeal` and `quickCreateProject` reuse the existing Zod schemas (`.pick`) and share the insert with `createDeal` / `createProject`, which now call `insertDeal` / `insertProject`. Deal creation keeps its audit entry. Project creation had no audit entry before and still has none.

**Deals.** The board uses `deal_stage` columns. Won and Lost are folded by default. A stage filter shows the single column unfolded. The next-activity dot uses the earliest of the deal's follow-up date and its open activities' due dates.

**Projects.** A List | Board switcher (`?view=board`) sits next to New project. List stays the default. Board columns follow `project_status` in the list's order. Cancelled is folded by default. The dot uses the deadline, except for delivered and cancelled projects.

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

## Open issues

- Moving a project by drag or menu calls the existing `updateProjectStatus`, which writes no audit entry (deal stage moves do). Adding one is a small follow-up in `projects/actions.ts`.
- Dragging to a column outside the visible board area relies on the browser's edge auto-scroll during a drag. The "Move to…" menu always works.
- Quick-created projects have no client. The Edit link opens the full form when a client is needed.
- An org with more than 1000 open dated activities can still lose some later due dots. The robust fix is a view or RPC returning the earliest open due date per deal, which needs a migration.
- The column header has no activity progress bar and there is no "+ Stage" column (Odoo has both). Stages are enums here.
