# W5d inventory and purchasing extras

Implemented on `odoo-w5d-inventory`, based on `odoo-parity` commit `e5022f1`. Only the assigned API 56101, database 56102 and application 3110 stack was used. Its existing Supabase project/container name remains `odoo-w4d-db`. Environment and stack files remain ignored. No dependency, lockfile, sibling-owned financial function, push or merge changed.

## Delivered behavior

1. `stock_balances` materializes each organization/product/warehouse balance. The posting trigger locks and updates that row atomically with its append-only move. Metadata uses shared product and warehouse locks; quantity writes no longer take a product UPDATE lock. Multi-product commands prelock balance keys in a stable order. Counts take their catalog write lock before metadata/balance locks because they still update catalog cost. `stock_on_hand` reads balances. The moves page applies every facet and joined text search in SQL and returns 100 rows plus a lookahead, using the posting sequence for older-page links.
2. `transfer_stock` posts one outgoing/incoming pair in one transaction. A durable organization-scoped command key rejects changed payloads and acknowledges matching retries. The destination receives the outgoing move's retained integer value, preserving quantity and value even when the precise average differs from the rounded unit cost. Transfers require sufficient source quantity even when negative stock is enabled.
3. Receipt and delivery commands create immutable headers and quantity/unit/description snapshots only for positive deltas. Numbers are organization/year scoped `GRN-YYYY-NNNNNN` and `DO-YYYY-NNNNNN`. Business dates do not reorder valuation. The Documents tab and source-record links lead to individual printable quantity documents. Older ledger entries remain identifiable without fabricated historical document grouping.
4. Purchasing settings include an over-receipt percentage, default zero. SQL and pure TypeScript validation compare exact quantities with the cap. Tightening the policy preserves unchanged historical over-receipts. Confirmed, received and billed orders retain receipt entry while any line has capacity. Each input shows the cumulative cap and remaining allowance. The page, input and pure validation share the integer-based `receiptLimit`. Forecast on-order quantities cannot become negative from an over-received line.
5. An optional integer-satang approval threshold requires a separate owner/admin approval before confirming a PO strictly above it. Approval records its actor/time and full header/line content. Confirmation rechecks the saved content under the PO lock, including edits that preserve the total. `purchase:approve` is a distinct capability held by owners/admins.
6. A failed, undelivered RFQ can be reopened after an owner/admin explicitly verifies non-delivery. Reopening audits the old claim and snapshot, clears approval/delivery state and restores draft editing. The next claim freezes edited content with a new delivery key. A late completion from the old attempt is rejected. An unresolved or accepted delivery cannot be reopened through this command.
7. Lead days are stored per organization/product/vendor. The read-only SQL plan supplies preview quantities and expected dates. Generated vendor RFQs use the longest selected lead time for their header expected date. Vendor locking plus the open-order forecast prevents duplicate manual replenishment while open quantities cover demand. Scheduled creation also stores the successful result by organization, Bangkok date and vendor, independently of subsequent PO status. The UI and cron use `readAllOrThrow` beyond the API cap, and a failed later page cannot create a partial plan.
8. The standalone customer-return report and failing check run before the earlier retained-value migration, without requiring its `stock_value_satang` column. The report identifies value differences, invalid source references and excess return quantities. See [the reconciliation procedure](../operations/customer-return-reconciliation.md). No historical reconciliation is applied automatically.

## Migration and function inventory

New transactional migrations are `20261026120000` through `20261026121000`. The review fix adds only `20261026121000_scheduled_replenishment_claim.sql`; earlier migrations remain unchanged. All migrations inherited from `e5022f1` remain unchanged. The exclusive ledger lock covers the balance backfill and posting-function replacement in one explicit transaction. The clean reset caught and corrected the Supabase runner's requirement for an explicit transaction around that lock.

New tables are `stock_balances`, `stock_transfers`, `stock_documents`, `stock_document_lines`, `product_vendor_lead_times`, and `scheduled_replenishment_runs`. Each has organization-qualified references and forced RLS. Authenticated callers can read their tenant data; public commands own writes. `stock_moves.document_id` is a tenant-qualified document reference.

Created functions:

```text
private.lock_stock_balances(uuid,uuid[],uuid[])
private.create_stock_document(uuid,text,date,uuid,uuid)
private.purchase_approval_content(uuid,uuid)
public.stock_moves_page(uuid,bigint,text[],uuid,uuid,uuid,uuid,timestamptz,timestamptz,text)
public.transfer_stock(uuid,uuid,uuid,uuid,numeric,text,uuid)
public.approve_purchase_order(uuid,uuid)
public.reopen_purchase_rfq(uuid,uuid,uuid,boolean)
public.update_purchase_order(uuid,uuid,uuid,date,date,text)
public.save_reorder_rule(uuid,uuid,uuid,numeric,numeric,integer)
public.replenishment_plan(uuid,date)
```

Replaced functions:

```text
private.value_stock_move()
public.receive_purchase_order(uuid,uuid,jsonb,uuid,date)
public.deliver_invoice(uuid,uuid,uuid,jsonb,date)
public.return_purchase_order(uuid,uuid,jsonb,uuid)
public.return_invoice_delivery(uuid,uuid,uuid,numeric)
public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,bigint)
public.transition_purchase_order(uuid,uuid,public.purchase_status)
public.create_purchase_order(uuid,uuid,date,date,text)
public.create_replenishment_rfq(uuid,uuid)
public.inventory_snapshot(uuid,uuid,uuid)
```

Receipt and delivery retain their existing arguments and add an optional final date. Their old four-argument database signatures are dropped, with existing ordinary calls resolving through the new defaulted date. No W5-a invoice/payment/tax function or W5-b bill/cost guard is redefined. Existing RFQ claim/finish functions are reused unchanged.

## Scheduler operation

Enable scheduled replenishment under Settings > Purchasing. Scheduling remains opt-in and creates draft RFQs for review. Configure the deployment scheduler to call `POST /api/cron/replenishment?dry_run=false` with the existing `X-Cron-Secret` header. `POST` without that explicit query previews only. `GET` always previews, even with `dry_run=false`. Invalid or missing secrets return 401. A failed organization-list scan returns 500. An organization or vendor failure returns 503, and successful vendors may already have draft RFQs. An error response does not imply that zero drafts were created. A successful vendor run and its daily claim commit together under the vendor lock. Same-day retries return that original RFQ, even after cancellation. A failed transaction leaves no claim. Later requirements for that vendor can use explicit manual replenishment or wait until the next Bangkok date. The dry-run preview remains a read-only forecast. No scheduler job or production deployment was created in this task.

## Verification and review

Baseline was 1,192 unit tests and 1,047 SQL assertions. Focused SQL checks cover each unit, same-balance concurrency, independent warehouse posting, competing deliveries and opposite-direction transfer completion. The dblink test derives its endpoint from the current test connection and asserts server/database identity. It has no external stack port or fallback. The local test database uses Supabase's standard synthetic database login.

The opposite-transfer schedule verifies blocking and successful completion while preserving totals. It does not exhaust every possible interleaving. Deterministic sorted lock acquisition is also inspected in source review.

Negative tests reproduced absent APIs/storage, exact tolerance refusal, stale approval after same-total edits, old delivery keys, no-op retries after warehouse deactivation and a stockable guard bypass through an existing zero balance. Fix regressions retain their failure and passing evidence in ignored `.audit/w5d-*` logs. The legacy-schema preflight test drops the later retained-value column inside a rollback-only transaction and still reports the known difference.

Independent source reviewers approved production source at `119c607`, including valuation/locking, function ownership, preflight, security and new tests. Their final reports also inspected the locator-only change through `a1694c5`. That purchasing selector is scoped to the product listbox because adding the editable vendor select exposed its previously broad option locator. Comment review found no unnecessary comments or suppressions. The recovery commit's additional transfer assertions were checked by the replacement worker and the full SQL suite, without a new independent review.

On 2026-10-23, the replacement worker found both unfinished paths already saved in recovery commit `2cfc3f6`. The worktree was clean. The retained transfer test forces the incoming leg to fail and verifies that the outgoing quantity, both ledger legs, and the command header all roll back. No production code changed during pickup.

Fresh gates ran one at a time at `2cfc3f6`, in the required order. Every command exited 0. Local execution logs remain in the ignored `.audit/` directory.

| Command | Result | Local evidence |
| --- | --- | --- |
| `.local-stack/db-reset.sh "$PWD"` | Clean migrations and seed, 46 SQL files, 1,151 assertions passed | `.audit/w5d-resume-sql.log` |
| `pnpm lint` | Passed | `.audit/w5d-resume-lint.log` |
| `pnpm typecheck` | Passed | `.audit/w5d-resume-typecheck.log` |
| `pnpm test` | 155 files, 1,205 tests passed | `.audit/w5d-resume-unit.log` |
| `pnpm build` | Production build passed | `.audit/w5d-resume-build.log` |
| `pnpm e2e` | Full suite, 51 passed, four expected Community skips, zero failures or timeouts | `.audit/w5d-resume-e2e.log` |
| `pnpm lint` | Final lint passed | `.audit/w5d-resume-final-lint.log` |

The earlier full browser run had 48 passes, four skips, and three failures. The purchasing selector collision was fixed in `a1694c5`. Purchasing, subscription resume, and labour privacy then passed a focused three-test rerun. All three also passed in the fresh full suite, without retries. The earlier subscription and labour timeouts did not recur. These results do not establish their original cause. No subscription or labour implementation, timeout setting, or sibling-owned database function changed during pickup.

## Review fixes on 2026-10-23

All three should-fix findings in `reviews/w5d.md` were reproduced against the prior artifact before production edits. Commit `484e3eb` contains the failing regressions. The SQL test observed two POs after cancelling a generated draft and retrying the same day. All three new browser cases failed because the receipt control disappeared or the recovered product select showed a different value. Evidence is `.audit/w5d-fix1-red-sql.log` and `.audit/w5d-fix1-red-browser.log`.

The fixes are separate local commits:

- `2601278` adds `20261026121000_scheduled_replenishment_claim.sql`, database types and pgTAP coverage. `create_replenishment_rfq(uuid,uuid)` keeps its signature. Only its service-role path records and replays `scheduled_replenishment_runs`, keyed by organization, Bangkok date and vendor. Vendor locking serializes the lookup, PO creation and claim insertion. The new table has tenant-qualified references and forced RLS; authenticated users and the service role have read access, with writes owned by the command. Manual replenishment retains its existing forecast behavior. The dblink regression holds the first transaction open after creating and cancelling the PO, proves that a concurrent retry waits, then verifies that it returns the original PO and leaves one claim.
- `b8e4ff5` updates the purchase detail page and receipt form with `receiptLimit` in `lib/purchasing/quantities.ts`. It shares the exact three-decimal cap among validation, form visibility, native input bounds and the displayed remaining quantity. Browser coverage receives the ordered quantity, adds a receipt while `received`, bills the PO, then adds the final allowed receipt while `billed`. Receipt entry disappears at the cap. Five pure cases cover fractional caps, retained historical over-receipts and large quantities.
- `3669d74` updates the transfer page and form. The fieldset uses the restored command key, so React initializes all native fields together after hydration. The page passes the complete option lists, and the form retains saved inactive choices or an ID-labelled fallback when a saved record is absent. Browser coverage checks every recovered field for active records and for an archived product with an inactive source warehouse. Retrying an already committed transfer keeps exactly two ledger legs and clears the saved command.

Focused checks passed 22 replenishment assertions, five scheduled concurrency assertions, 23 unit tests and all three formerly failing browser cases. Logs are `.audit/w5d-fix1-{green-sql,concurrency,focused-unit,green-browser}.log`.

Final gates ran one after another against code head `3669d74` on the assigned stack:

| Command | Result | Local evidence |
| --- | --- | --- |
| `.local-stack/db-reset.sh "$PWD"` | Clean migrations and seed; 47 SQL files, 1,166 assertions passed | `.audit/w5d-fix1-sql.log` |
| `pnpm lint` | Passed | `.audit/w5d-fix1-lint.log` |
| `pnpm typecheck` | Passed | `.audit/w5d-fix1-typecheck.log` |
| `pnpm test` | 155 files, 1,210 tests passed | `.audit/w5d-fix1-unit.log` |
| `pnpm build` | Production build passed | `.audit/w5d-fix1-build.log` |
| `pnpm e2e` | One full run; 54 passed, four expected Community skips, no failures or retries | `.audit/w5d-fix1-e2e.log` |
| `pnpm lint` | Final lint passed | `.audit/w5d-fix1-final-lint.log` |

The earlier independent source approvals do not cover these new commits. This worker inspected the patch and ran the checks above; coordinator review and integration remain. No sibling-owned financial function, dependency, lockfile, environment or stack configuration changed. Nothing was pushed or merged.

## Remaining operational limits

Existing incompatible historical returns require an approved reconciliation before the earlier retained-value migration can run. A later count adjustment cannot repair the historical predicate. No live email provider was exercised; RFQ tests use claim/finish state and synthetic failures. This task creates the cron route, not a deployment scheduler. Four Pro-only browser skips are expected in Community. All requested local gates are complete. Coordinator review and integration remain outside this worker's scope. Nothing was pushed or merged.
