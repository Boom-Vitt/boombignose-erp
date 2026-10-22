# W3a inventory handover

Implemented 2026-10-23 on branch `odoo-w3a-inventory`, based on the supplied `odoo-parity` track.

The migration `supabase/migrations/20261024120000_inventory.sql` adds warehouses, an append-only stock ledger, durable count command keys, forced tenant RLS, stock views, reorder fields and the negative-stock setting. Receipt quantities and receipt moves share the existing purchasing transaction through `lib/purchasing/receive.ts`. Invoice delivery posts once, including concurrent retries. Product-row locks serialize quantities across different invoices; multi-product commands acquire locks in product-ID order.

`app/(app)/inventory/` contains on-hand/value overview, filtered ledger, physical counts, warehouse management and vendor-grouped replenishment RFQs. `lib/inventory/` owns schemas, actions, queries and pure quantity/cost/replenishment logic. Invoice, purchase and product detail pages reuse StatusBar and SmartButtons. Shared navigation, permissions, status commands, database types, facets and saved-view allowlists have minimal additive inventory entries. Seed appends two stockable demo goods, opening receipts and a synthetic delivery.

## Valuation and correction rules

Valuation is perpetual moving average per organization, product and warehouse. The immutable posting sequence determines order; a business timestamp never rewrites prior cost. Receipts weight their integer satang cost against the quantity and precise average still on hand. Deliveries and outgoing adjustments retain that average. Positive count adjustments retain the existing precise average and therefore do not reprice previously held goods. The stored average has ten decimal places; display unit cost and inventory value round to integer satang only at the edge. The pure reference function uses fixed-point bigint arithmetic to match this rounding, including half-satang and negative values.

A zero balance resets average cost. When negative stock is explicitly enabled, outgoing stock retains the last average; the next receipt restarts cost from its receipt price. Opening counts at zero or negative balances use catalog cost. These are deliberate policy choices, not FIFO, landed cost, financial journal postings or backdated revaluation.

Corrections append new moves. Authenticated users cannot insert, update or delete ledger rows directly. Used warehouses and stockable products with stock history retain their references. A physical count records its command even when the count produces no move, so a retry cannot undo a later posting. Replenishment rechecks current server-side totals under product locks and refuses a second open inventory RFQ for the same vendor.

The pstack Make Operations Idempotent principle shaped cumulative receipts, one-time delivery and durable no-op counts. Prove It Works keeps source approval separate from the still-unexecuted database and browser checks.

## Verification

Baseline before changes was 108 test files and 755 tests passing. Final local gate evidence is recorded below. No new dependency was installed.

`pnpm lint` exited 0. Its complete final output was:

```text
$ eslint
```

`pnpm typecheck` exited 0. Its complete final output was:

```text
$ tsc --noEmit
```

`pnpm test` exited 0. Final lines were:

```text
 Test Files  112 passed (112)
      Tests  766 passed (766)
   Start at  03:00:04
   Duration  10.42s (transform 12.99s, setup 0ms, import 128.08s, tests 4.51s, environment 9ms)
```

`pnpm build` exited 0. Compilation reported `✓ Compiled successfully in 6.6s`, all five inventory routes appeared in the route table, and the final lines were:

```text
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

The added unit tests exercise every move sign, invalid quantities, fractional quantities, precise moving average, count valuation, negative/zero resets, replenishment grouping, saved ledger facets, the atomic receipt hook and a 1,001-row stock read. Independent read-only source review found and verified fixes for vendor lock ordering, count valuation rounding and resetting uncontrolled facet selectors. The final source-review verdict was APPROVE, qualified by absent database execution. Its targeted Vitest run passed all 11 inventory/receive tests.

## Integration checks still required

No database or Docker stack was started. This worktree has no `.local-stack/isolation.json` or `.env.local`. `pnpm e2e -- inventory.spec.ts --list` exited 1 before test discovery with:

```text
code: 'ENOENT',
syscall: 'open',
path: '.local-stack/isolation.json'
```

The coordinator must apply the migration to its integration database and execute `supabase/tests/inventory.sql`. That pgTAP suite covers forced RLS, tenant isolation, direct ledger mutation refusal, atomic partial-receipt rollback, receipt retries, negative-stock refusal/opt-in, issued-invoice delivery retries, competing delivery refusal, count idempotency, precise valuation, replenishment and member restrictions. SQL source assertions check the product-lock contract; they are not a substitute for an actual concurrent run.

After configuring the authorized isolated integration environment, run `pnpm e2e -- inventory.spec.ts`. The browser test creates its own stockable product, receives a PO, issues and delivers an invoice, checks quantity changes and records a physical count. The second test uses concurrent delivery RPC requests for two invoices competing over one unit, then concurrent retries of the winning invoice, and asserts exactly one delivery. Both runtime tests remain NOT VERIFIED here.

Synthetic opening seed moves use adjustment source references so they never link to unrelated commercial documents. Transfers have enum kinds but no transfer UI/RPC in this track. No screenshots were required. No push, merge or external publication was performed.


## Integration round, 2026-10-23

Merged the requested `odoo-parity` head `7ccf5d9` into `odoo-w3a-inventory` as merge commit `c2fc34a`. Resolved all six conflicts with both behaviors retained:

- The invoice detail page retains `DocumentTotals`, WHT selection and per-line tax rates, plus Deliver and Deliveries. Payments use the upstream separate exact-count query.
- Purchasing receipt actions keep the optional warehouse and atomic stock receipt hook while reading lines through `readAllOrThrow`. Upstream frozen RFQ claims, cascade-delete handling and Bangkok paid dates remain intact.
- Saved-view module and grouping allowlists include both inventory and projects/stage/owner options.
- SearchFacets accepts inventory selectors and page-owned params together. Filter links, search hidden inputs and saved-view links preserve the active view, while selector fields appear only once. The added rendered-component regression covers this combined contract and inventory saved-view creation.
- Database types include VAT settings and tax columns, RFQ claim fields/RPCs, inventory tables/views/RPCs and the negative-stock flag.

The deleted `lib/purchasing/pagination.ts` and its test remain deleted. A repository search found no old pager imports or `allPurchasingRows` references. Inventory continues to use the shared `readAll` helper. Independent read-only review compared all six resolutions with both Git index stages and approved the resolution; it did not claim SQL/browser runtime validation.

The coordinator then supplied upstream commit `b676bf6`, which renames search throttle to `20261024140000_search_throttle.sql` and adds a migration-prefix uniqueness test. That follow-up merged without conflicts. Inventory retains its reserved `20261024120000_inventory.sql` version.

Final integration gates:

```text
pnpm lint: exit 0
$ eslint

pnpm typecheck: exit 0
$ tsc --noEmit

pnpm test: exit 0
 Test Files  118 passed (118)
      Tests  819 passed (819)
   Start at  03:20:36
   Duration  5.72s (transform 12.62s, setup 0ms, import 71.49s, tests 2.58s, environment 6ms)
```

`pnpm build` exited 0 and reported `✓ Compiled successfully in 7.8s`. Its final lines were:

```text
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` passed and no conflict markers or unmerged entries remain. No SQL or browser runtime tests were executed, and no Supabase or Docker startup was performed. The coordinator applies the migration and runs `supabase/tests/inventory.sql` and `e2e/inventory.spec.ts` on the integration database after worker completion.

## Review fix round 1, 2026-10-23

Regression commits `a31378e` and `18fa9c4` precede implementation commit `ad5d3dc`. The applied `20261024120000_inventory.sql` is unchanged; its Git blob hash remains `4b6749b3dc262e8161bc68b6f583c61572fb0fb7` against `6b08477`.

- New migration `20261024120500_inventory_fixes.sql` locks a product's unit after stock history, retaining the existing stockable-product guard. `lib/products/actions.ts` translates the database error into a friendly form message. Ordinary edits and unit changes before the first move remain allowed.
- `lib/inventory/retry-command.ts`, the count form and its page persist the complete pending command in sessionStorage under organization/user scope before posting. Reload restores the payload and Retry saved count action. Changed payloads cannot reuse the pending key; thrown failures and returned errors retain it. A successful server acknowledgment clears it. If browser storage is unavailable, posting is refused with a message so an unrecoverable command is never sent.
- Inventory queries now read quantities, values, product metadata and balance rows through one stable, security-invoker `inventory_snapshot` RPC. Its single database statement aggregates balances without offset paging or API row caps. Warehouses and vendors still use the shared pager. The query schema and public database type are updated; database UUID validation accepts PostgreSQL IDs used by the demo seed.
- Incoming moves may reduce an existing deficit after negative stock is disabled. Outgoing moves that leave stock negative are still refused. The existing product-lock and moving-average paths are preserved.
- `e2e/inventory.spec.ts` explicitly fills Unit with `piece`, checks the unit-lock form error, and simulates a committed count whose response is lost. It reloads, receives two more units, retries the saved count and expects seven units with exactly one count move.

The local failing-before evidence reproduced a shifted-page total of `1.002` instead of `1.001`, raw product-unit errors, replacement of a pending command key after reload, acceptance of an edited pending payload, posting without usable storage, and clearing a key on a returned transport error. A final review regression reproduced rejection of the seeded demo organization UUID. The final targeted run passed all 19 tests across queries, product actions and count recovery. SQL-only invariants have pgTAP regressions in `supabase/tests/inventory_fixes.sql`; their failing/passing runtime status is not claimed here.

Independent read-only review approved the final source patch, including the UUID and ambiguous-response corrections. No new dependency was added. Final local gates all exited 0:

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  119 passed (119)
      Tests  828 passed (828)
   Start at  03:38:14
   Duration  4.14s (transform 7.30s, setup 0ms, import 50.70s, tests 2.33s, environment 7ms)
```

`pnpm build` reported `✓ Compiled successfully in 3.5s`, included all five inventory routes, and ended with:

```text
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` passed. The coordinator must apply the new fix migration after the original inventory migration, run both `supabase/tests/inventory.sql` and `supabase/tests/inventory_fixes.sql`, then run `e2e/inventory.spec.ts` on the integration database. These SQL/browser checks remain unexecuted here; no Supabase or Docker stack was started. SessionStorage recovery lasts for the current browser tab session, as requested; closing that session discards its recovery data.

## Integration round 2, 2026-10-23

Merged the requested `odoo-parity` head `4bd97d0` into inventory head `d33e112` as `53ff1d3`. All five conflicts retain both module contracts:

- `app/(app)/purchases/actions.ts` keeps `receivePurchaseStock`, its optional chosen warehouse and stock-page refreshes. Database IDs use `z.guid()`. The upstream RFQ claim/finish email flow and its seed-ID tests remain intact.
- `lib/products/actions.test.ts` retains the friendly stock-unit error test and upstream seeded-ID catalog tests.
- `lib/record/status.ts` includes Deliver and Reject commands, invoice delivery actions and `EXPENSE_FLOW`.
- `lib/types/database.ts` includes inventory tables, views, RPCs and the negative-stock flag alongside expense tables, RPCs, cost references and record types. `vat_registered` remains readable and generated, with `never` for inserts/updates.
- `supabase/seed.sql` preserves every inventory and expense block from both parents verbatim.

The inventory actions and schemas, inventory overview URL filters, and inventory saved-view filters now accept PostgreSQL GUID IDs. `CountInput.key` continues to require an RFC UUID because it is an application-generated retry key. The seven new regressions in `lib/inventory/seed-ids.test.ts` failed before the change, including `Invalid UUID` on a saved view and inventory filters becoming `undefined`. They pass after the change. A purchasing regression also checks that a chosen warehouse with a seed-shaped ID reaches the atomic receipt RPC. The targeted four-suite run passed 28 tests, including `lib/migrations.test.ts`.

Both inventory migration files remain byte-identical to `d33e112`, with reserved versions `20261024120000` and `20261024120500`. No pager was added. The inherited upstream manifest/lockfile changes are retained without manual lockfile edits. Independent read-only review approved all five resolutions and the GUID sweep, confirmed both parents' seed blocks, and passed 79 targeted tests. A separate comment review found no new comments or suppressions. Prove It Works kept these source checks distinct from the pending integration runtime checks.

Final gates on the merged source all exited 0:

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  125 passed (125)
      Tests  900 passed (900)
   Start at  03:42:41
   Duration  6.77s (transform 11.56s, setup 0ms, import 77.46s, tests 4.66s, environment 8ms)
```

`pnpm build` reported `✓ Compiled successfully in 4.1s`, included the inventory and expense routes, and ended with:

```text
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` passed. There are no remaining conflict markers or unmerged entries. No database or browser runtime checks were run, and no Supabase or Docker startup was performed. Coordinator integration must apply migrations and execute both inventory SQL suites and `e2e/inventory.spec.ts`.


## Procure-to-stock round 3, 2026-10-23

Fast-forwarded the required upstream `odoo-parity` selector fixes to `7b3b579` before work. New migration is `supabase/migrations/20261025130000_procure_stock.sql`; the original two inventory migrations are unchanged. Audit findings supplied the behavior ideas only. No external Odoo/ERPNext source, CSS or assets were copied and no dependency was added.

Implemented B1/B2/S3/S5/S7/S8/S9/S10/S11 across purchasing/inventory commands, forms and financial summaries:

- Product-linked purchase, quote and invoice lines must match the catalog unit. Quote/invoice checks use a separate trigger, without redefining their owned guards. The coordinator approved locking a catalog unit after any document line references it, in addition to the stock-history lock. Catalog price/name/archive edits still preserve agreement snapshots. Existing mismatched units cause an explicit migration preflight failure; retained agreements are never rewritten automatically.
- `closed` is reachable from a partially received confirmed PO, freezes the remaining quantity, stays closed when billed, and maps onto the Received status-bar step. All list/filter enum registrations include it. Forecast buying excludes closed POs and includes remaining quantities from draft/sent/confirmed POs, regardless of notes. Both SQL and TypeScript require positive reorder quantities and order the greater of reorder quantity and forecast shortfall.
- Vendor returns keep cumulative returned quantities per PO line, cap both original line receipts and aggregate PO/product/warehouse receipts (including legacy moves without line IDs), and post only the new return delta. Credits cover only the returned portion exceeding the remaining unbilled quantity. Cumulative rounding prevents fractional credits from duplicating satang.
- **Coordinator valuation override:** the initial dispatch asked for vendor stock returns at PO cost; the coordinator instead explicitly required CURRENT average cost for outgoing stock, original PO cost for vendor credits, and an `inventory` cost adjustment for the difference. The adjustment uses rounded before/after balance values so full depletion removes exactly the remaining value. The expensive-PO/cheap-current-stock regression expects current value 500 ->450, credit -1000 and adjustment +950, then value 0 on full return. `purchase_cost_kind` distinguishes bill/credit/return_adjustment; internal adjustments have no vendor ID/due date, and the UI and payment action do not treat them as payables. Existing vendor-bill guards retain valuation fields; they still allow a direct authenticated `paid_at` update, which does not make an internal adjustment a vendor payable.
- Partial invoice deliveries use chosen cumulative quantities and displayed prior delivered quantities. Per-line delivery/return counters live in forced-RLS `invoice_line_stock`, exposed through `invoice_stock_lines`, because issued `invoice_items` are immutable and W4-a owns their guard. Legacy whole-invoice deliveries are backfilled without modifying ledger or financial lines. Customer returns reference the original move and restore its warehouse/cost. Returns do not reopen delivered remainder. Available quantity subtracts all undelivered issued invoice quantities; this is a warning/forecast, not a hard warehouse reservation.
- Warehouse deactivation is serialized against posting and refuses any non-zero product balance, including deficits. Raising a count from zero/negative stock requires an explicit unit cost and updates catalog cost from the resulting warehouse average. Count recovery retains explicit cost and exact retry payloads across ambiguous transport failures; a confirmed SQL P0001 rejection releases the matching saved command for correction.
- Receipt payloads carry the displayed `previous_received_quantity`. The SQL transaction checks it before posting, including when the submitted total happens to equal the newer stored total, returning `Receipt changed, reload` on mismatch.
- New stock purchase bills/credits and return adjustments use cost category `inventory`; mixed new bills split inventory and operating lines. Dashboard, Finance burn and MCP burn exclude that category. Dashboard, all Reports views and report print show monthly delivery COGS, net of customer returns. The security-invoker COGS view uses cumulative return rounding per original move, including across month boundaries. Report inputs and invoice stock reads use the shared pager; live inventory forecasts/balances use the single SQL snapshot. Existing historic cost categories are retained; this migration does not guess how to reclassify already issued mixed legacy bills.

Primary files are the new migration and `supabase/tests/procure_stock.sql`; `lib/{inventory,purchasing}/`; inventory/purchase pages and components; invoice detail; the shared status/database registries; dashboard cost query; finance cost helper/page; reports data/page/print; MCP burn helper; and matching unit tests. `e2e/inventory.spec.ts` now performs two chosen partial deliveries, passes receipt preconditions and supplies opening count cost. Older purchasing/inventory/product SQL fixtures follow the new contracts.

Every created/replaced SQL function in this migration:

```text
private.guard_product_line_unit()
private.guard_referenced_product_unit()
private.guard_purchase_line()
private.value_stock_move()
public.transition_purchase_order(uuid,uuid,public.purchase_status)
public.receive_purchase_order(uuid,uuid,jsonb,uuid)
public.bill_purchase_order(uuid,uuid)
public.return_purchase_order(uuid,uuid,jsonb,uuid)
public.deliver_invoice(uuid,uuid,uuid,jsonb)
public.return_invoice_delivery(uuid,uuid,uuid,numeric)
public.adjust_stock(uuid,uuid,uuid,numeric,text,uuid,bigint)
public.save_warehouse(uuid,uuid,text,text,text,boolean,boolean)
public.inventory_snapshot(uuid,uuid,uuid)
public.create_replenishment_rfq(uuid,uuid)
```

The previous three-argument delivery and six-argument count functions are replaced with trailing optional arguments. Existing full-delivery calls remain supported. No invoice issue/payment/quote conversion/subscription/invoice-line/quote guard function is redefined. Dashboard revenue logic is untouched, preserving W4-d's seam.

Unit regressions were observed failing before fixes, including forecast ordering, stale receipt payloads, count-cost persistence/rejection recovery, zero-value billing, exact thousandths, internal adjustment payments, no-warehouse service returns, operating-cost exclusion, COGS report data and paging past 1,000 rows. Example cost regressions initially returned 135,000 instead of 50,000, dashboard 28,800,000 instead of 18,800,000, and MCP 13,000,000 instead of 5,000,000. Final independent application review passed 173 tests in 20 files. SQL regressions were authored before the migration and cover all requested database behaviors plus the review edge cases, but their RED/GREEN runtime status is **not claimed** here.

Final gates all exited 0 on the completed application patch:

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  126 passed (126)
      Tests  934 passed (934)
   Start at  04:03:46
   Duration  4.98s (transform 7.16s, setup 0ms, import 59.52s, tests 4.91s, environment 6ms)

pnpm build
├ ƒ /vendors/new
└ ƒ /warehouse


ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` and project-memory validation also pass. Independent source reviewers approved both the application patch and the exact migration/test artifacts. SQL approval hashes are migration `69d83630e78accc5edc43c0b2ad2b7f7077a23cd50bf1cf131b51d1b7e0c7cb9` and pgTAP `298520f3c6fe6422bd17c5eadae857f59630e669fee6c6c7c11747e82f62f594`. Source review is distinct from runtime SQL/browser validation.

Coordinator integration must apply the migration after existing purchasing/inventory fixes, execute `supabase/tests/procure_stock.sql`, `inventory.sql`, `inventory_fixes.sql`, `purchasing.sql`, `purchasing_fixes.sql` and `products.sql`, then run inventory and purchasing browser tests. No Supabase/Docker startup, database connection, migration execution or browser run occurred in this worktree.

Before applying, inspect existing mismatches with an authorized org-scoped query. This is the preflight shape, not an automatic repair:

```sql
select l.kind,l.id,l.product_id,l.unit as document_unit,p.unit as catalog_unit
from (
  select 'purchase' as kind,id,org_id,product_id,unit from public.purchase_order_items
  union all select 'quote',id,org_id,product_id,unit from public.quote_items
  union all select 'invoice',id,org_id,product_id,unit from public.invoice_items
) l join public.products p on p.org_id=l.org_id and p.id=l.product_id
where l.org_id = :org_id and l.unit is distinct from p.unit;
```

If it finds retained agreements, coordinate their repair through the owning track before applying. Multi-warehouse vendor returns require choosing a warehouse with unreturned original receipt allowance; legacy duplicate-product receipts are capped at the pooled original PO warehouse allowance. Opening count cost becomes the product's last counted warehouse average, not a new cross-warehouse valuation method.
