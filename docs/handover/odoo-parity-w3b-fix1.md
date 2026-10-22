# Wave 3b expenses, fix round 1

Finance now recognises costs created by an approved expense claim. Approval inserts those costs with no `vendor_id` and no `purchase_order_id`, so the Costs tab used to offer Delete on them, and `private.guard_expense_cost` rejected every click. The same branch hid their `paid_at`, so a reimbursed claim looked unpaid.

## What changed

- The Finance costs query selects `expense_claim_id`.
- The Bill column links an expense cost's claim number to `/expenses/<claim id>`.
- The Payment column shows `Reimbursed YYYY-MM-DD` (Bangkok date, same helper as vendor bills) once the claim is paid, and `Awaiting reimbursement` before that. There is no Mark paid button, because reimbursement happens on the claim.
- Delete is hidden for expense costs, as it already was for vendor and PO bills. Manual costs keep it.

No SQL functions were created or replaced. No migration.

## Files

- `app/(app)/finance/page.tsx`
- `lib/expenses/finance-costs.test.ts` (new): renders the Finance costs tab with an expense cost, a reimbursed expense cost and a manual cost.
- `e2e/expenses.spec.ts`: after approval, the Finance row shows `Awaiting reimbursement`, links the claim number to `/expenses/<uuid>` and has no Delete button.

## Verification

Executed in this worktree on 2026-10-23, after merging `odoo-parity` at `4bd97d0` (fast-forward, no conflicts).

The new Vitest file was committed first (`0c97b78`) and failed against the old page:

```text
× links an expense cost to its claim and offers no Delete the database would refuse
× shows when an expense cost was reimbursed, in Bangkok time
AssertionError: expected '<div class="space-y-6">…' to contain 'href="/expenses/claim-1"'
AssertionError: expected '<div class="space-y-6">…' to contain 'Reimbursed 2026-10-24'
Tests  2 failed | 1 passed (3)
```

After the fix (`57129df`), final gate output:

```text
pnpm lint
$ eslint                                  (exit 0)

pnpm typecheck
$ tsc --noEmit                            (exit 0)

pnpm test
      Tests  874 passed (874)             (exit 0)

pnpm build
✓ Compiled successfully in 3.6s
ƒ  (Dynamic)  server-rendered on demand   (exit 0)
```

## Open issues

- The new e2e assertions were not run here, because Supabase was not started on this shared machine. They need the integration database.
- Every member can read costs, and the Finance page has no page-level capability gate. A member who is not the claimant and not staff will see the claim link but get a 404 from the claim page, because claim RLS hides it. Nothing leaks, since the claim id is already on the cost row.
