# W5d inventory and purchasing extras

Implemented on `odoo-w5d-inventory`, based on `odoo-parity` commit `e5022f1`. Only the assigned API 56101, database 56102 and application 3110 stack was used. Its existing Supabase project/container name remains `odoo-w4d-db`. Environment and stack files remain ignored. No dependency, lockfile, sibling-owned financial function, push or merge changed.

## Delivered behavior

1. `stock_balances` materializes each organization/product/warehouse balance. The posting trigger locks and updates that row atomically with its append-only move. Metadata uses shared product and warehouse locks; quantity writes no longer take a product UPDATE lock. Multi-product commands prelock balance keys in a stable order. Counts take their catalog write lock before metadata/balance locks because they still update catalog cost. `stock_on_hand` reads balances. The moves page applies every facet and joined text search in SQL and returns 100 rows plus a lookahead, using the posting sequence for older-page links.
2. `transfer_stock` posts one outgoing/incoming pair in one transaction. A durable organization-scoped command key rejects changed payloads and acknowledges matching retries. The destination receives the outgoing move's retained integer value, preserving quantity and value even when the precise average differs from the rounded unit cost. Transfers require sufficient source quantity even when negative stock is enabled.
3. Receipt and delivery commands create immutable headers and quantity/unit/description snapshots only for positive deltas. Numbers are organization/year scoped `GRN-YYYY-NNNNNN` and `DO-YYYY-NNNNNN`. Business dates do not reorder valuation. The Documents tab and source-record links lead to individual printable quantity documents. Older ledger entries remain identifiable without fabricated historical document grouping.
4. Purchasing settings include an over-receipt percentage, default zero. SQL and pure TypeScript validation compare exact quantities with the cap. Tightening the policy preserves unchanged historical over-receipts. Forecast on-order quantities cannot become negative from an over-received line.
5. An optional integer-satang approval threshold requires a separate owner/admin approval before confirming a PO strictly above it. Approval records its actor/time and full header/line content. Confirmation rechecks the saved content under the PO lock, including edits that preserve the total. `purchase:approve` is a distinct capability held by owners/admins.
6. A failed, undelivered RFQ can be reopened after an owner/admin explicitly verifies non-delivery. Reopening audits the old claim and snapshot, clears approval/delivery state and restores draft editing. The next claim freezes edited content with a new delivery key. A late completion from the old attempt is rejected. An unresolved or accepted delivery cannot be reopened through this command.
7. Lead days are stored per organization/product/vendor. The read-only SQL plan supplies preview quantities and expected dates. Generated vendor RFQs use the longest selected lead time for their header expected date. Vendor locking plus the open-order forecast prevents duplicate manual/scheduled replenishment. The UI and cron use `readAllOrThrow` beyond the API cap, and a failed later page cannot create a partial plan.
8. The standalone customer-return report and failing check run before the earlier retained-value migration, without requiring its `stock_value_satang` column. The report identifies value differences, invalid source references and excess return quantities. See [the reconciliation procedure](../operations/customer-return-reconciliation.md). No historical reconciliation is applied automatically.

## Migration and function inventory

New transactional migrations are `20261026120000` through `20261026120900`. All migrations inherited from `e5022f1` remain unchanged. The exclusive ledger lock covers the balance backfill and posting-function replacement in one explicit transaction. The clean reset caught and corrected the Supabase runner's requirement for an explicit transaction around that lock.

New tables are `stock_balances`, `stock_transfers`, `stock_documents`, `stock_document_lines`, and `product_vendor_lead_times`. Each has organization-qualified references and forced RLS. Authenticated callers can read their tenant data; public commands own writes. `stock_moves.document_id` is a tenant-qualified document reference.

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

Enable scheduled replenishment under Settings > Purchasing. Scheduling remains opt-in and creates draft RFQs for review. Configure the deployment scheduler to call `POST /api/cron/replenishment?dry_run=false` with the existing `X-Cron-Secret` header. `POST` without that explicit query previews only. `GET` always previews, even with `dry_run=false`. Invalid or missing secrets return 401. A failed organization-list scan returns 500. An organization or vendor failure returns 503, and successful vendors may already have draft RFQs. An error response does not imply that zero drafts were created; retries recheck existing forecast quantities. No scheduler job or production deployment was created in this task.

## Verification and review

Baseline was 1,192 unit tests and 1,047 SQL assertions. Focused SQL checks cover each unit, same-balance concurrency, independent warehouse posting, competing deliveries and opposite-direction transfer completion. The dblink test derives its endpoint from the current test connection and asserts server/database identity. It has no external stack port or fallback. The local test database uses Supabase's standard synthetic database login.

The opposite-transfer schedule verifies blocking and successful completion while preserving totals. It does not exhaust every possible interleaving. Deterministic sorted lock acquisition is also inspected in source review.

Negative tests reproduced absent APIs/storage, exact tolerance refusal, stale approval after same-total edits, old delivery keys, no-op retries after warehouse deactivation and a stockable guard bypass through an existing zero balance. Fix regressions retain their failure and passing evidence in ignored `.audit/w5d-*` logs. The legacy-schema preflight test drops the later retained-value column inside a rollback-only transaction and still reports the known difference.

Independent source reviewers approved production source at `119c607`, including valuation/locking, function ownership, preflight, security and new tests. A later purchasing browser selector is scoped to the product listbox because adding the editable vendor select exposed its previously broad option locator. Comment review found no added comments or suppressions.

Current completed checks are lint, typecheck and 1,205 unit tests. A clean full SQL run at `0338008` passed 1,146 assertions. The production build passed. Final fresh reset including migration 209 and final full browser results are pending below. The first full browser run ended with 48 passed, four expected skips and three failures. The purchasing selector collision is fixed. The unchanged subscription-resume and labour tests, together with purchasing, passed an isolated three-test rerun. The cause of those two initial failures was not established, and no subscription/labour implementation or timeout setting changed.

## Remaining operational limits

Existing incompatible historical returns require an approved reconciliation before the earlier retained-value migration can run. A later count adjustment cannot repair the historical predicate. No live email provider was exercised; RFQ tests use claim/finish state and synthetic failures. This task creates the cron route, not a deployment scheduler. Four Pro-only browser skips are expected in Community. Integration into the coordinator's branch is the next delivery step after final gates pass.
