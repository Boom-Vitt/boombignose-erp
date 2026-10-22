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
