# W4-d time metrics handover

## Outcome and scope

S10 adds an atomic `Bill time` command on Timesheets. Staff select a project; the command creates a new draft through the existing invoice and line insert paths. It bills every positive-duration billable entry with a rate whose invoice is absent or cancelled, and links each entry to both its invoice and its own line. The command locks the project and selected rows and persists an org-scoped idempotency result. A retry returns the same draft. An error rolls the command back. No invoice issue/lifecycle/payment function is redefined.

Time entries linked to any active invoice, including drafts, are frozen by RLS and a trigger. Members edit/delete only their own unbilled or cancelled-invoice time; staff can edit/delete any such entry. Server Actions check the same authority, return errors when RLS prevents a mutation, and audit successful changes. Timesheets show invoice links, lock state and editing controls.

S9 uses non-draft, non-cancelled invoices, `total_satang - vat_satang`, recognized by `issue_date`, for dashboard, report, print and Finance revenue. Discounts are reflected in the base; WHT remains revenue. Verified receipts still settle receivables and drive cash burn. Finance shows verified cash as a separate figure.

Member hourly labour cost now lives in staff-only `member_cost_rates.cost_rate_satang`, defaults to zero, and is staff-managed on Timesheets. Fix round 1 migrates the original membership column and removes it. Project profit subtracts a SQL labour aggregate for every logged minute, including non-billable and unrated work. Rates apply to all historical time at the current member rate; missing/deleted memberships cost zero. Membership RLS is self-only, with a staff read policy for team listing; the security-invoker labour view now uses a workspace-member-checked aggregate-only definer function. Project profit therefore does not depend on which membership rows the viewer can select.

I7 shares integer `BigInt` valuation in the two TypeScript time helpers and exact numeric `div(minutes * rate + 30, 60)` in SQL. The regression `11 minutes × 150 satang/hour` now gives 28 rather than 27. Invalid/unsafe rates and amounts fail closed. Timesheets, report invoices/time, and project time use the shared `readAll` pager; labour totals are computed in SQL.

## Files

- Database and SQL scenarios are `supabase/migrations/20261025110000_time_metrics.sql` and `supabase/tests/time_metrics.sql`.
- Pure metrics and regressions are in `lib/metrics/**`; dashboard data and tests are in `lib/queries/dashboard*`.
- Timesheet actions/page and the billing, cost-rate and edit controls are in `app/(app)/timesheets/**`.
- Reporting uses `app/(app)/reports/_data.ts`, `app/(app)/reports/page.tsx`, and `lib/documents/report.ts`.
- Project profit consumes `project_labour_totals` in `app/(app)/projects/[id]/page.tsx`.
- Coordinator-approved shared edits are additive database types, Finance revenue selection/card plus separate cash card, and affected document/active-org test fixtures. Expense-cost rows and invoice lifecycle actions were not changed.

## Initial migration SQL function ownership

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

## Initial delivery gates

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

## Initial delivery integration checks (superseded by fix round 1)

At initial delivery, SQL was written and reviewed against the existing migrations but had not been executed by this worker. The coordinator explicitly confirmed it will run at merge. The SQL scenarios cover own/other/staff authority, invoice and line linking, billed-time freezing, cancellation/rebilling, retries, injected rollback, labour totals across membership RLS, outsider isolation and 1,001-entry billing. Apply the migration and run `supabase/tests/time_metrics.sql` on the integration database before release.

No Supabase or Docker service was started. Browser/E2E testing and independent patch review were not performed by this worker. Existing invalid time rates/values cause migration constraint validation to abort rather than being silently repaired. Configure member cost rates before relying on labour-inclusive profit; current-rate costing intentionally does not retain historical rate snapshots.


## Review fix round 1, 2026-10-23

Merged integration `c8be5f7` before changes. The dedicated stack is API `56101` and app `3110`; no other stack was used. New changes are in migration `20261025110500_time_metrics_fixes.sql`, `supabase/tests/time_metrics_fixes.sql`, the Timesheets rate query, database types, and `e2e/time-metrics.spec.ts`. Applied migrations were left unchanged.

Individual rates now live in `member_cost_rates`, copied from the previous membership column before it is removed. RLS is enabled and forced; only workspace staff can select rates, and rate changes retain the audited staff RPC. Members cannot read even their own rate. The individual scalar helper is removed. The project aggregate remains visible to workspace members through a membership-checked aggregate function and the existing security-invoker view. Staff-only rate queries use `readAll`; new members default to zero until staff sets a rate.

The time guard permits only verified nested FK author cleanup when the auth parent is gone and other time fields are unchanged. This retains both unbilled and billed time after user deletion, including invoice links. Direct member/staff reassignment or manual null-out remains forbidden.

W4-a already makes cancelled drafts final. SQL tests now bill A, cancel A, rebill B, reject client and database-owner reopening of A, reject issuing A, and assert the time stays linked to B. No invoice-owned function was changed. A rollback-only mutation disabling the cancellation trigger made the reopen/issue probes fail, proving the regression test is sensitive to that guard.

The failing SQL regression was committed first as `35f1556`. Before the fix, 5 of 16 assertions failed: scalar execution, membership rate exposure, a raw rate read returning 150 instead of no rows, auth deletion raising `Time author is immutable`, and the author not becoming null. With the fix, all tests in the full SQL suite pass, including three additional aggregate-isolation and billed-author cleanup checks. The browser regression exercises staff rate management, member rate privacy and project totals, source-time locking, and cancellation/rebilling.

Functions in this fix migration are new `private.project_labour_totals(uuid)` and replaced `public.set_member_cost_rate(uuid,uuid,bigint)` plus `private.guard_time_entry()`. Removed obsolete functions are `private.time_member_cost_rate(uuid,uuid)` and `private.guard_member_cost_rate()`. No W4-a function was redefined.

The first full browser run found a separate real UI defect in the original time controls: the house Base UI `Button` defaults to `type="button"`. Save cost rate, Bill time and Save time did not submit their forms. The failing browser regression was committed as `b61f9a7`; the three controls now explicitly use `type="submit"`, and the regression checks persisted cost-rate changes, saved notes and invoice creation through the real UI.

The coordinator then requested the latest shared form guard. Merged integration `4a98a8b` as `a5cffd2`, including W4-f record UX and `lib/forms-submit.test.ts`. Repeated application gates on that merged artifact; all 138 unit-test files / 1,007 tests pass. The form guard supplements the browser regression; `onSubmit` alone does not ensure a Base UI button submits.

Final fix-round checks all exited 0 on the merged artifact. No other stack was touched. The configured Community browser run includes four pre-existing Pro-only skips (portal payment, workspace switching, additional-workspace provisioning and accounting integration).

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  138 passed (138)
      Tests  1007 passed (1007)
   Start at  04:23:48
   Duration  7.00s (transform 13.01s, setup 0ms, import 88.51s, tests 6.11s, environment 11ms)

pnpm build
└ ƒ /warehouse

ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand

.local-stack/db-reset.sh "$PWD"
All tests successful.
Files=24, Tests=657,  4 wallclock secs ( 0.09 usr  0.03 sys +  0.11 cusr  0.10 csys =  0.33 CPU)
Result: PASS
db-check ok: a5cffd2

pnpm e2e
✓ 29 [chromium] › e2e/time-metrics.spec.ts:16:5 › staff rates stay private while members see labour totals and cancelled time rebills once (5.5s)
  4 skipped
  42 passed (1.3m)
```

`git diff --check` and the project-local memory validation also pass. Logs are local `/tmp/w4d-fix1-{db,sql,red,cancel-mutation,lint,typecheck,test,build,e2e}.log`; the durable excerpts above include the final complete SQL reset and full browser run. Local `.env.local`, `.local-stack` configuration and generated test artifacts were not committed. No unresolved fix-round issue remains; Pro-only browser paths were not exercised in this Community build.
