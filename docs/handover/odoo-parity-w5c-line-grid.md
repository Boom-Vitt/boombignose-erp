# W5c line grid handover

2026-10-23. Track `odoo-w5c-line-grid`. Local commits only; do not push or merge as part of this worker task.

## User behavior

Quotes, invoices and purchase orders use the same editable line grid. Description, product, quantity, unit, price or cost, and supported VAT rates edit locally until Save lines. Discounts remain in the existing document header. Totals use the existing pure satang and tax functions and reflect draft line edits immediately. Each save sends all changes in one action and one transactional RPC, then adopts the server's rows.

Add line, section and note controls focus the new row. Enter moves down the same column, Shift+Enter moves up, and Enter past the end adds a line. Tab past the final cell of a filled final row adds a line. Drag handles reorder rows; up/down arrows on a handle provide keyboard reordering and a live announcement. Blank new rows that were never edited are ignored on save; unfinished rows with edited values require a description instead of disappearing.

The grid registers with the existing record save guard. Actions save dirty lines first. Record fields freeze while a guarded action runs and remain frozen through its refreshed result. Accepted quote, issued invoice and non-draft purchase lines retain their existing locks. Section and note rows print in display order in quote, invoice and purchase PDFs without affecting amounts.

## Implementation and ownership

- `lib/line-grid/grid.ts` owns the discriminated `GridRow` shape, reducer, validation, payload, interleaving and totals preview. `queries.ts` loads lines and sections through `readAllOrThrow`; `actions.ts` validates input with Zod, checks the existing capability, calls the RPC, audits and reloads authoritative rows.
- `components/line-grid/line-grid.tsx` replaces the separate quote, invoice and purchase line editors. The three detail pages pass their existing document locks, VAT basis, catalog and read-only quantities. Old per-item actions and editors were removed rather than kept as a second path.
- The existing `ProductPicker` supports compact grid labels, database-backed search and Create and edit. Product snapshots and the purchase cost path retain their existing checks.
- `lib/record/guard.ts` and `components/record/record-guard.tsx` add an acting state and `RecordFields`/`useGuardedEditor`. Quote, invoice, deal and project header forms use `RecordFields`. Invoice issue keeps its existing saved-version requirement.
- `components/document-totals.tsx` accepts an optional test id for separate draft totals. `lib/documents/printable.ts` and the three PDF routes interleave sections and notes with the priced lines.
- `lib/types/database.ts` declares the new table and RPC.

## Database functions

Migration `20261026110000_line_grid.sql` creates the forced-RLS table `public.document_sections`, its tenant policies and parent/tenant checks. Priced lines stay in the existing line tables, so existing line guards, totals, snapshots, conversion and stock functions never see an amount-free line. It also grants draft purchase line updates on the existing guarded columns and adds the matching staff update policy.

New functions are `private.guard_document_section()`, `private.line_grid_rows(jsonb)` and `public.save_document_lines(text,uuid,jsonb,uuid[])`. No existing SQL function is replaced, including W5a's line guards and issue/conversion functions or W5b/W5d's purchase commands. The section guard mirrors each parent's current line locks. The save function runs as the caller, preserves RLS and line guards, uses stable row ids for retries, rejects duplicate ids, and retains rows another editor added meanwhile. A failure rolls the entire batch back.

## Resume and commits

The replacement worker inherited completed commits `a52215d`, `0783fe0`, `e459560`, `86ea6b7`, `97d39ba`, `75c18f0` and coordinator WIP checkpoint `072cc90`. The worktree was clean at pickup because the coordinator had committed the prior agent's six unfinished paths. Those changes were reviewed and retained.

Follow-up `008bc84` migrates five existing browser test files to the grid, adds invoice and purchase section/note PDF assertions, and retains catalog snapshot, stock, purchasing, time and tax behavior checks. All six prior browser failures reproduced individually before migration; all eight related scenarios passed afterward.

Follow-up `539ac0a` fixes silent loss when quantity, price or unit was entered before description on a new row. Three regression tests failed with missing validation before the fix and passed afterward. The reducer now tracks edited row ids and clears that state on server reset or discard.

## Client record guard race

The coordinator explicitly approved a client-only guard follow-up. Two unit tests and two browser tests failed before the fix. A header initially clean could become dirty during the line pre-save and be skipped by the guard's copied editor snapshot; its database notes stayed null after Accept. An already-saved line could change during the header pre-save and then disappear when Accept completed.

Commit `3a13759` updates `createRecordGuard.run` to iterate the current editor Map, marks each successful save clean under its existing promise contract, and refuses the action if any previously visited editor becomes dirty again. This preserves pre-save editing and the W4g pending-header behavior. It does not add a retry loop or change a SQL guard. Focused record/grid/workflow tests passed 192 assertions. Both new race cases passed individually on the production build, then all four grid scenarios passed together. The browser tests wait for the final readonly UI before deleting fixture workspaces, avoiding cleanup racing the refresh.

## Keyboard boundary

The final keyboard audit added a regression to the main grid browser scenario. After ArrowUp on the first row's handle, editing its description lost focus because the failed move had queued a handle focus for the next render. The assertion failed before the fix. Commit `60ce21a` queues handle focus only when a row actually moves, preserving valid keyboard reordering and drag behavior. The same production browser scenario then passed, including its existing drag, valid keyboard move, batch save and PDF assertions.

## Verification

All seven gates passed serially on final source commit `60ce21a` on 2026-10-23. The full browser run began from a fresh isolated reset. The local stage exit codes are retained in `.audit/w5c-release-gates.json`; every exit code is zero.

| Gate | Result |
| --- | --- |
| `.local-stack/db-reset.sh "$PWD"` | Complete SQL suite, 34 files and 1,094 tests passed, including `supabase/tests/line_grid.sql` |
| `pnpm lint` | Passed |
| `pnpm typecheck` | Passed |
| `pnpm test` | 150 files and 1,214 tests passed |
| `pnpm build` | Production build passed |
| Full `pnpm e2e` | 53 passed, 4 expected Community skips, no failures |
| `pnpm lint` after e2e | Passed |

The three unfinished-row regressions, two client-guard unit/browser regressions and keyboard boundary assertion were each observed failing before their fixes and passing afterward. The main grid scenario checks spreadsheet navigation, drag and keyboard reorder, sections and notes, one server-action save, authoritative database rows, exact live totals and PDF parity. Existing product, inventory, purchasing, time and VAT/WHT browser workflows now use the same grid. Invoice and purchase PDF checks include sections and notes.

Earlier runs were not counted as passing. The first full run had 45 passed, 6 failed and 4 skipped; all six reproduced individually at removed controls or static description queries before test migration. A later full run had one CSV GET `ECONNRESET`, and that case passed alone unchanged. Retrying the full suite without resetting then exposed one facet fixture failure because the prior suite's stage test left no Proposal-stage deal. Grouped database counts and test source confirmed the fixture state; the facet test subsequently passed alone after the later stage test restored that deal. The final fresh-seed full run above passed all applicable cases. No timeout was treated as a pass.

Local logs and the checklist are in ignored `.audit/w5c*`; authenticated request headers are redacted from retained diagnostics. Project instructions and local memory were initialized and updated in the repository's existing ignored paths.

## Isolation and remaining work

This track's app is 3109, API is 56001 and DB is 56002. The reset helper's target directory is historically named `odoo-inv-db`; Docker mapping and its Supabase config confirm that it is the correct isolated stack. The helper comment mentioning 556xx is stale. Never reset the integration stack or use the checked-in default Supabase config directly for this track.

Worker implementation and standalone verification are complete. The coordinator owns independent integration review and combined-wave checks, including comparing the section guard with W5a's final invoice locking policy. No push, merge or external publication has occurred.

## Workflow choices

Model the Domain kept the existing typed row reducer and used a set of edited row ids for unfinished-row validation. Fix Root Causes changed the shared client guard's stale iteration instead of adding per-form workarounds. Prove It Works required observed red/green assertions, actual database values and production browser flows. One worker owned this code-coupled track and its isolated database, and every required full gate ran serially.
