# W4-a finance integrity

2026-10-23. This track closes B2, S5, S6, S12, I4 and I8 with forward migration `supabase/migrations/20261025090000_finance_integrity.sql`.

The integration round against `odoo-parity` at `6c74f65` passes the full SQL suite, full Community browser suite and all four pnpm gates. Its results below supersede the initial dispatch's unexecuted SQL and browser status.

| Finding | Result |
| --- | --- |
| B2 | Every payable invoice state requires an issued snapshot. Cancelled unissued drafts cannot reopen. Content editing accepts no status and only updates unissued drafts. `cancel_draft_invoice` is an explicit, repeatable command. |
| S5 | Separate invoice and quote line triggers refuse positive VAT without registration. Issuance rechecks registration under the profile share lock. Existing W4-c quote and commercial guard functions are untouched. |
| S6 | Issuance replaces the draft date with Bangkok today and allocates by that year. `org_settings.lock_date` is inclusive. Issues and verified receipt writes enforce it. Privileged updates and deletes also check the original verified receipt date. Settings > Finance lets owners and admins set or clear the date. |
| S12 | Draft creation uses a full UUID reference and reads no series numbers. Finance list, detail and draft PDF display `DRAFT-<first eight ID characters>`. Manual numeric INV series references are reserved. Counter allocation has no skip loop and rolls back with the issue transaction. |
| I4 | Evidence-free review and reconciliation functions are dropped. Verification and reconciliation require an explicit finite bank date and method. `paid_at` is Bangkok midnight on that date. Rejection uses the evidence RPC with null date and method and creates no cash. |
| I8 | The one-pending unique index is replaced by a partial lookup index. Both claim commands lock the invoice and aggregate all verified cash plus all pending reservations before admitting another claim. Only the same command key identifies a retry. |

Model the Domain kept lifecycle transitions in commands and used a discriminated input for verification versus rejection. Laziness Protocol reused existing tax math, command result tables, row locks and the shared pager. Prove It Works required observed unit failures before the fixes and the four project gates before handoff.

Changed files are the migration and `supabase/tests/{finance_integrity,finance_issue_evidence,payment_rollback,client_balances}.sql`; Finance actions, item actions, invoice form, cancel button, new/detail/PDF/list pages; `app/(app)/settings/page.tsx` and `settings/finance/{page,finance-lock-form}.tsx`; `lib/documents/numbering{,.test}.ts`, `lib/payments/{integrity-action,invoice-item-action,staff-action}.test.ts` and `lib/types/database.ts`. The coordinator expanded ownership to include `supabase/seed.sql` and `e2e/{payment-security.api.test.mjs,payment-verification.spec.ts,record-header.spec.ts,vat-wht.spec.ts}` because the lifecycle change invalidates direct payable inserts.

The seed creates complete draft lines and issues demo invoices 1 through 5 in order. The sixth remains a draft. Existing synthetic unverified payment assertions remain unverified. The browser and API fixtures issue through the owner command. API regressions cover concurrent competing claim reservations. The VAT browser test now saves a lock, observes refused issuance, clears the lock and retries issuance.

All eleven created or replaced functions are listed here.

| Function | Change |
| --- | --- |
| `private.assert_finance_date_open(uuid,date)` | Created. Shared inclusive date-lock assertion, callable by security-definer commands. |
| `public.update_finance_lock_date(uuid,date)` | Created. Staff-only setting command with audit. |
| `private.guard_receipt_period()` | Created. Verified receipt insert, update and delete period guard. Organization teardown remains possible. |
| `private.guard_line_vat_registration()` | Created. Attached separately to invoice and quote lines. |
| `private.guard_invoice_issue()` | Replaced. Lifecycle and number authority. |
| `public.cancel_draft_invoice(uuid,uuid)` | Created. Staff-only final draft cancellation with audit. |
| `public.issue_invoice(uuid,uuid,integer,uuid)` | Replaced. Registration, date lock, actual issue date and transactional numbering. |
| `public.submit_payment_claim(text,uuid,bigint,text,uuid)` | Replaced. Aggregate pending capacity. |
| `public.submit_internal_payment_claim(uuid,uuid,bigint,text,uuid)` | Replaced. Aggregate pending capacity. |
| `public.review_payment_claim_with_evidence(uuid,uuid,bigint,text,uuid,text,date,public.payment_method)` | Replaced. Snapshot required for settlement. Bank evidence mandatory for verification. |
| `public.reconcile_legacy_payment_with_evidence(uuid,uuid,bigint,text,uuid,date,public.payment_method)` | Replaced. Snapshot required for reconciliation. Period guard checks bank date. |

Removed functions are `public.review_payment_claim(uuid,uuid,bigint,text,uuid,text)` and `public.reconcile_legacy_payment(uuid,uuid,bigint,text,uuid)`. No W4-c function is replaced, including `private.guard_invoice_line`, `private.guard_commercial_customer`, conversion and subscription generation.

Final local verification exited 0 for each gate. These are the final output lines or completion markers.

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  120 passed (120)
      Tests  881 passed (881)
   Start at  03:56:11
   Duration  17.43s

pnpm build
✓ Compiled successfully in 3.5s
  Finished TypeScript in 4.8s ...
✓ Generating static pages using 17 workers (23/23) in 146ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check`, `node --check e2e/payment-security.api.test.mjs` and `python3 .project-memory/read.py --check` also pass. Local memory and `.audit/` evidence remain ignored and uncommitted.

Before implementation, targeted unit runs observed status forwarding, manual series acceptance, missing bank evidence acceptance and positive VAT acceptance. The initial integrity run had 8 failures, the evidence run had 1, and the VAT action run had 1. All pass after implementation. The first full unit run exposed three PDF mock fixtures without invoice identity. The PDF route now uses its already-known route ID, and the full rerun passes.

The initial `supabase/tests/finance_integrity.sql` contained 74 pgTAP assertions. They cover the six findings, more than 1,000 pending claims, issue audit-failure rollback, command retries, inclusive date boundaries and staff authorization. SQL, API and browser execution were not run in the initial dispatch because starting Supabase or Docker was forbidden. The subsequent integration dispatch explicitly assigned an isolated stack and those checks were run there, as recorded below. Screenshots are not required and were not taken.

Integration dependencies remain explicit. W4-b corrections must call `private.assert_finance_date_open(org_id, correction_date)`. The helper is revoked from client roles and available inside its security-definer commands. Claim and settlement functions still calculate net cash as `sum(payments.amount_satang) where verification_state='verified'`; reversal representation must preserve that contract or be integrated into the aggregate. W4-c conversion must use an unnumbered draft reference rather than `INV-` plus an arbitrary custom quote number. The coordinator was notified of both contracts.

The migration only normalizes issued-pattern references on draft or cancelled rows without verified cash. Historical unissued payable evidence and historical issued numbers are preserved. Existing numbering gaps are not renumbered. A conflicting historical series reference makes issuance fail transactionally rather than skip a number and needs explicit operator review.

Implementation commits begin with `dfa0323` for database invariants and SQL regressions, followed by `83a65ea` for application commands, settings and unit coverage. The initial fixture and handover commit is `f5202dd`. The integration round fast-forwards this branch to `6c74f65`; no push or merge into main occurs.


## Integration verification, 2026-10-23

Fast-forwarded the worker branch to `odoo-parity` at `6c74f65`. Verified and used only the assigned API 55701, DB 55702 and app 3106. The ignored `.local-stack/db-reset.sh "$PWD"` resets that temporary stack, applies every migration and seed, and runs the full SQL suite. The production build loads this worktree's `.env.local` before Playwright starts the app.

All observed integration failures were stale test fixtures. No product bug, application implementation change, new SQL function or production grant change was needed in this round.

| File | Failure and correction |
| --- | --- |
| `supabase/tests/finance_integrity.sql` | Portal claim calls ran as authenticated despite the service-only RPC grant. Calls now run as service_role, with INSERT on the temporary result table only, then restore authenticated. Two new assertions preserve the authenticated and anonymous execution denial. This also resolves the cascading claim-capacity and rejection failures. Finance now has 76 assertions. |
| `supabase/tests/time_metrics.sql` | Direct draft cancellation violated lifecycle authority. The fixture calls `cancel_draft_invoice` and still verifies time unlock and rebilling. No W4-d function changes. |
| `supabase/tests/vat_wht.sql` | Expected the old open-balance error. It now expects `Report exceeds unclaimed open balance`. |
| `e2e/inventory.spec.ts` | Looked for `Invoice number` and a manual draft heading. It now uses `Draft reference (optional)` and asserts the `DRAFT-<short ID>` heading. The full receipt, delivery, count and lost-response retry scenario remains exercised. |

Before the fixture fixes, the SQL run failed six finance assertions and one VAT assertion, and time metrics aborted after 19 assertions. The browser run reproduced `waiting for getByLabel('Invoice number', { exact: true })`, then ended with 1 failed, 4 skipped and 40 passed. These failures were observed locally before the passing reruns.

Final commands and output excerpts all exited 0.

```text
SB="$PWD/node_modules/.bin/supabase" .local-stack/db-reset.sh "$PWD"
All tests successful.
Files=23, Tests=638
Result: PASS

pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  129 passed (129)
      Tests  929 passed (929)
   Start at  04:06:25
   Duration  6.47s

pnpm build
✓ Compiled successfully in 4.1s
  Finished TypeScript in 6.3s ...
✓ Generating static pages using 17 workers (23/23) in 153ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand

pnpm e2e
  4 skipped
  41 passed (54.2s)

node --test e2e/payment-security.api.test.mjs
ℹ tests 12
ℹ pass 12
ℹ fail 0
ℹ skipped 0
```

The four browser skips are the existing Pro-only portal payment, workspace switching, additional workspace provisioning and accounting tests. The direct payment API suite also passes same-key review retries and competing distinct claim reservations. `git diff --check` and the local memory reader check pass. No screenshots were required. Logs remain local under ignored `.audit/`.

The SQL fixture correction is commit `eff4272`. The inventory fixture and this handover follow in a separate commit. There are no open failures on this integrated revision. The future W4-b correction and W4-c conversion contracts above still apply when those sibling tracks merge. No secrets or local stack configuration are committed.
