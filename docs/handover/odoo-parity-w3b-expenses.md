# Wave 3b expenses handover

Team members can now claim out-of-pocket spending at `/expenses`. A claim gets an `EXP-YYYY-NNN` number and holds dated, categorised lines that can be tagged with a project to re-bill. The claimant submits it, and every owner and admin except the claimant gets a follow-up activity. The claimant can withdraw it until someone decides. An approver then approves it, which writes one Finance cost per line, or rejects it with a reason. Approved claims are marked paid when reimbursed. The To approve tab lists other people's submitted claims and their approved claims that still need paying. The detail page uses the shared StatusBar, SmartButtons (linked costs and projects) and RecordHistory, so receipts are record attachments. The dashboard's Needs attention card counts claims waiting on the viewer.

## Data and invariants

- `supabase/migrations/20261024130000_expenses.sql` adds `expense_status`, `expense_claims`, `expense_lines`, `costs.expense_claim_id`, `'expense_claim'` in `record_type` and `private.record_exists`, and two security-definer commands: `create_expense_claim` and `transition_expense_claim`.
- Claims change only through `transition_expense_claim`. Authenticated users have no update grant on claims. It is the one state machine. The claimant may submit, withdraw (submitted to draft) and reopen (rejected to draft). Owners and admins who are not the claimant may approve, reject (from submitted or approved) and mark paid. Self-decisions are refused in SQL, and a null target is refused. A repeated transition to the current status is a no-op, so retries never duplicate costs. `lib/expenses/flow.ts` mirrors the table for the UI, and a unit test pins the two together.
- Approve inserts the costs and moves the status in one function call, so it is one transaction. Reject deletes them in the same call. Paid stamps `paid_at` on the claim and its costs. A decision or a withdrawal closes the open approver activities. Check constraints tie `submitted_at`, `decided_*`, `decision_note` (rejections only) and `paid_at` to the status, so an inconsistent row cannot be stored.
- RLS is enabled and forced on both tables. Members read their own claims and staff read all of them. Lines follow claim visibility. Members insert and delete lines only on their own draft claims. A line trigger locks the claim row, the same row the transition command locks, so line edits serialize with submit and approve. It also enforces the safe-integer claim total.
- `private.guard_expense_cost` stops authenticated users from inserting, editing or deleting costs linked to a claim. Those costs follow their claim.
- Every member can read `costs`, so expense costs carry `Employee expense` as the payee and `Expense claim EXP-…` as the note, with the claim number as `bill_number`. They do not carry the claimant's name or the line text. Finance totals stay the same for every viewer.
- The record notes and attachments read policies now also require `record_exists` for `expense_claim` rows, so a receipt's metadata is as private as its claim. Restrictive policies on `activities` do the same for activities on a claim, and only let the assignee or staff complete or delete them. Other record types keep their old policies.
- `supabase/seed.sql` appends one submitted claim from the first seeded member, with two lines (one re-billing the first project), the approver activity and the `EXP` counter.

## Files

New code lives in `app/(app)/expenses/**` and `lib/expenses/**`, plus `supabase/tests/expenses.sql` and `e2e/expenses.spec.ts`. Additive shared changes are in `components/nav.ts` (Expenses entry), `lib/permissions.ts` (`expense:approve` for owner and admin), `lib/record/status.ts` (`EXPENSE_FLOW`, three status labels, the `reject` command), `lib/record-history/model.ts`, `lib/types/database.ts`, the dashboard Needs attention card and the seed. The detail page reuses the purchasing `PurchaseAction` button for line removal.

## Verification

Executed in this worktree on 2026-10-23, after merging `odoo-parity` at `75e8342` into this branch. The merge was clean. Parity's new `lib/purchasing/paid-date.test.ts` builds a full `costs` row, so it gained `expense_claim_id: null`. All four source gates exited 0 on the merged tree. Final lines:

```text
pnpm lint
$ eslint                                  (exit 0)

pnpm typecheck
$ tsc --noEmit                            (exit 0)

pnpm test
 Test Files  115 passed (115)
      Tests  824 passed (824)

pnpm build
✓ Compiled successfully in 5.2s
├ ƒ /expenses
├ ƒ /expenses/[id]
├ ƒ /expenses/new
```

Unit tests in `lib/expenses/flow.test.ts` cover the transition table against every enum pair and four actor kinds, no self-decisions, the viewer-narrowed status bar, claim totals including the safe-integer bound, and the line input parser (baht to satang, zero and three-decimal amounts refused, seeded non-RFC ids accepted).

No Docker or Supabase was started. The SQL was run in a throwaway PGlite harness instead. It runs PostgreSQL 18 in WASM with real pgTAP and Supabase auth and storage stand-ins, applies every migration and `seed.sql`, and lives outside the repo in the session scratchpad. `supabase/tests/expenses.sql` passes 69/69. The other 17 SQL test files on the merged tree also pass, including parity's `purchasing_fixes`, `vat_wht` and `search_throttle`, so existing suites are unaffected. The migration version `20261024130000` is the one the coordinator reserved for this track. A seed check confirmed the seeded claim, its lines, the approver activity and the counter. A mutation check showed the tests catch regressions: removing the self-decision guard failed the no-self-approval and no-self-rejection tests, and removing the cost deletion on reject failed the orphan-cost tests. The harness runs migrations as a superuser on PG 18 rather than as Supabase's `postgres` on PG 15, so the integration run is still the real check.

`pnpm exec playwright test e2e/expenses.spec.ts --list` stops before discovery with `ENOENT .local-stack/isolation.json`, as on the purchasing track. The e2e spec has not run. It signs in as the first seeded member, creates a claim, adds a line, submits and checks Approve is hidden. It then signs in as the owner, approves from the To approve tab, checks the Costs smart button, and finds the cost by claim number in Finance.

Two independent reviews ran on the branch: a Claude reviewer with SQL probes, and Codex (gpt-6.1-sol, read-only). The first Codex attempt was refused by its provider's safety filter and the retry ran without probes. Both reported the same four issues, and all four are fixed with tests: activities on a claim were visible to and editable by unrelated members; approved costs exposed the claimant name and line text to every member; approved claims were missing from the approver's lists, so Mark paid was hard to reach; and `z.uuid()` rejected the seeded project ids. Codex also found that a null target status could reopen an approved claim and leave its costs behind. That is fixed and tested. From the Claude review, a claimant can now withdraw a submitted claim, so a sole owner's own claim cannot get stuck. Removing a line from a claim that is no longer a draft now returns an error instead of silent success.

## Open issues

- Apply the migration on the integration database, then run `supabase/tests/expenses.sql` and `e2e/expenses.spec.ts` there.
- Finance is outside this track's files. It still shows Delete on expense costs, and the guard refuses it with "Expense costs follow their claim". It shows "—" for their paid state, and it prints the claim number without a link. The fix is to select `expense_claim_id` in `app/(app)/finance/page.tsx`, hide Delete for those rows, and link `bill_number` to `/expenses/<id>`.
- Approver activities are scheduled for every owner and admin at submit time. Someone promoted later gets no activity for claims already waiting, but the To approve tab and the dashboard count still show those claims.
- A workspace with a single owner and no admin cannot approve that owner's own claims. They can only withdraw them. This follows from the no-self-approval rule.
- The expenses list reads every visible line to total the listed claims, as purchasing does. This is marked as a shortcut in `lib/expenses/queries.ts`.
- Submit is offered on a claim with no lines. The server refuses it with "Add expense lines first", and the page says so above the line form.
