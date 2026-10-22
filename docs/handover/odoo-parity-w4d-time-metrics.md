# W4-d time metrics handover

## Outcome and scope

S10 adds an atomic `Bill time` command on Timesheets. Staff select a project; the command creates a new draft through the existing invoice and line insert paths. It bills every positive-duration billable entry with a rate whose invoice is absent or cancelled, and links each entry to both its invoice and its own line. The command locks the project and selected rows and persists an org-scoped idempotency result. A retry returns the same draft. An error rolls the command back. No invoice issue/lifecycle/payment function is redefined.

Time entries linked to any active invoice, including drafts, are frozen by RLS and a trigger. Members edit/delete only their own unbilled or cancelled-invoice time; staff can edit/delete any such entry. Server Actions check the same authority, return errors when RLS prevents a mutation, and audit successful changes. Timesheets show invoice links, lock state and editing controls.

S9 uses non-draft, non-cancelled invoices, `total_satang - vat_satang`, recognized by `issue_date`, for dashboard, report, print and Finance revenue. Discounts are reflected in the base; WHT remains revenue. Verified receipts still settle receivables and drive cash burn. Finance shows verified cash as a separate figure.

Member hourly labour cost lives in `memberships.cost_rate_satang`, defaults to zero, and is staff-managed on Timesheets. Project profit subtracts a SQL labour aggregate for every logged minute, including non-billable and unrated work. Rates apply to all historical time at the current member rate; missing/deleted memberships cost zero. Membership RLS was verified as self-only, so staff receive a read policy for rate management and the security-invoker labour view uses a workspace-member-checked definer lookup. Project profit therefore does not depend on which membership rows the viewer can select.

I7 shares integer `BigInt` valuation in the two TypeScript time helpers and exact numeric `div(minutes * rate + 30, 60)` in SQL. The regression `11 minutes × 150 satang/hour` now gives 28 rather than 27. Invalid/unsafe rates and amounts fail closed. Timesheets, report invoices/time, and project time use the shared `readAll` pager; labour totals are computed in SQL.

## Files

- Database and SQL scenarios are `supabase/migrations/20261025110000_time_metrics.sql` and `supabase/tests/time_metrics.sql`.
- Pure metrics and regressions are in `lib/metrics/**`; dashboard data and tests are in `lib/queries/dashboard*`.
- Timesheet actions/page and the billing, cost-rate and edit controls are in `app/(app)/timesheets/**`.
- Reporting uses `app/(app)/reports/_data.ts`, `app/(app)/reports/page.tsx`, and `lib/documents/report.ts`.
- Project profit consumes `project_labour_totals` in `app/(app)/projects/[id]/page.tsx`.
- Coordinator-approved shared edits are additive database types, Finance revenue selection/card plus separate cash card, and affected document/active-org test fixtures. Expense-cost rows and invoice lifecycle actions were not changed.

## SQL function ownership

New functions only; no existing function is replaced.

- `private.guard_time_entry()`.
- `private.guard_member_cost_rate()`.
- `private.time_member_cost_rate(uuid, uuid)`.
- `public.set_member_cost_rate(uuid, uuid, bigint)`.
- `public.bill_project_time(uuid, uuid, uuid)`.

The SQL test additionally defines `public.test_fail_time_billing()` and an injected-failure trigger inside its rolled-back test transaction.

## Decisions and run trail

2026-10-23. Applied the scaled BBN sequence, Ponytail full and pstack poteto-mode/figure-it-out. Read source research and existing code, used Graft to trace the time helper, and kept the work in this assigned worktree. No fan-out, merge or push was performed.

2026-10-23. Wrote the metric/authority regressions before implementation and observed six failures. They included wrong rounding (27 vs 28), receipt-based revenue (31,398 vs 10,000), missing labour (1,000 vs 4,028), and missing authority helpers. The targeted tests passed after implementation. Action tests separately reproduced unauthorized deletion and billed-draft deletion before the fixes. Seed GUID billing also failed before switching stored IDs to the repository's `z.guid()` convention.

2026-10-23. Existing invoice quantities have three decimals and cannot represent every minute as hours. The coordinator approved one quantity-1 `entry` line with the exact rounded charge as its unit price. Its description records exact minutes, hourly rate in satang, date and notes. Billing uses the organization's standard VAT rate when registered; the draft remains reviewable before issue.

2026-10-23. The first full test run found legacy receipt-based fixtures. The coordinator approved minimal fixture and label changes. Full tests then passed, including 1,001-row report totals, failed-page handling, project labour before invoicing and existing tenant isolation checks.

## Final gates

All commands exited 0 on 2026-10-23. Final output excerpts follow.

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  121 passed (121)
      Tests  887 passed (887)
   Start at  03:53:14
   Duration  4.11s (transform 6.86s, setup 0ms, import 46.78s, tests 3.69s, environment 6ms)

pnpm build
└ ƒ /warehouse

ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` and the project-local memory reader's `--check` passed. No new npm dependency was added. Gate logs are local `/tmp/w4d-{lint,typecheck,test,build}.log`; the excerpts above are the durable record.

## Remaining integration checks

SQL is written and reviewed against the existing migrations but has not been executed by this worker. The coordinator explicitly confirmed it will run at merge. The SQL scenarios cover own/other/staff authority, invoice and line linking, billed-time freezing, cancellation/rebilling, retries, injected rollback, labour totals across membership RLS, outsider isolation and 1,001-entry billing. Apply the migration and run `supabase/tests/time_metrics.sql` on the integration database before release.

No Supabase or Docker service was started. Browser/E2E testing and independent patch review were not performed by this worker. Existing invalid time rates/values cause migration constraint validation to abort rather than being silently repaired. Configure member cost rates before relying on labour-inclusive profit; current-rate costing intentionally does not retain historical rate snapshots.
