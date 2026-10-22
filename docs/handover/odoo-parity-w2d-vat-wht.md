# VAT and withholding document calculations

2026-10-23. The integration round merges `odoo-parity` at `2407c61`; all four gates pass with 782 tests. The track adds quote/invoice VAT, invoice withholding, immutable issued totals, Finance profile defaults, buyer tax ID/branch fields, and matching portal and printable totals. README's operational-only stance remains. UI help states this is not a legal tax system, ledger, tax filing service, or e-Tax Invoice.

## Money contract

The coordinator approved this contract during the dispatch. Do not subtract WHT from `amount_satang` again.

| Field | Meaning |
| --- | --- |
| `invoices.subtotal_satang` | Entered line amounts before discount. Includes VAT only for inclusive-price documents. |
| `invoices.vat_satang` | Document VAT after discount, rounded once per rate. |
| `invoices.total_satang` | Gross document total, discounted pre-VAT base plus VAT, before WHT. |
| `invoices.wht_satang` | WHT on the discounted pre-VAT base, rounded once per document. |
| `invoices.amount_satang` | Collectible amount due, `total_satang - wht_satang`. Existing payment/balance contracts continue using it. |
| `tax_breakdown` | Per-rate base and VAT totals for presentation. |
| `prices_include_vat` | Price mode copied on document creation and retained across settings changes and quote conversion. |

`COMMENT ON COLUMN` records the net/gross distinction in the migration. Legacy lines keep zero tax; the migration does not retroactively tax documents or rewrite issued JSON snapshots. Snapshot version 1 gains optional fields; the parser retains support for old snapshots.

`lib/tax/totals.ts` uses bigint internally and returns safe integer satang to existing application readers. PostgreSQL uses exact numeric arithmetic. Discount allocation uses proportional rate buckets and largest remainders, with ascending rate as the tie-break. Inclusive VAT is extracted after discount. Quotes have no WHT; converted invoice drafts can select it without changing accepted gross terms. Supported WHT rates are 0, 1, 2, 3, and 5 percent.

## Existing reader audit

| Reader | Money source after this change |
| --- | --- |
| Payment submission/review/reconciliation RPCs and settlement guards | `invoices.amount_satang` minus verified payments. No WHT subtraction in readers. |
| Finance list/detail, overdue/status metrics, receivables CSV, invoice email requests | `amount_satang` for money owed. Complete paginated payment reads for balances. |
| Dashboard unpaid/overdue and invoice MRR reference | `amount_satang`. Primary MRR remains subscriptions. |
| Dashboard/Finance cash revenue and reports | Verified `payments.amount_satang`, unchanged. |
| Client balance view from t1 | `20261023150000_client_balances.sql` is now merged and still reads `amount_satang`. Its `invoiced_satang` is the aggregate collectible amount, not the gross document total. |
| Portal | Stored subtotal/VAT/gross/WHT/net fields and verified receipts for outstanding. Reads paginate and fail closed. |
| Draft invoice PDF | Stored header totals; synthetic no-line fallback uses retained subtotal before discount. Title is `Invoice`. |
| Issued invoice PDF | Frozen snapshot. `Tax Invoice / ใบกำกับภาษี` only for seller VAT registration frozen at issue; seller/buyer tax IDs and branches retained. |
| Quote detail/PDF/portal and quote conversion | `quotes.total_satang` remains gross including VAT. |
| Accounting provider `totalBaht` and MCP `invoiced_total_satang` | `total_satang`, with legacy fixture fallback. MCP unpaid continues using net `amount_satang`. |
| Existing project billed-profit estimate and project invoice labels | Continue reading `amount_satang`. This is an existing billed estimate, not verified cash revenue; project/facet work is outside this track. |

Financial reads in the dashboard, Finance list/detail/export, PDF routes, and portal use `lib/supabase/read-all.ts`, with stable unique ordering and pages below the API cap. Quote/invoice draft numbering scans also paginate. A failed later page discards partial financial data. Other tracks retain ownership of their readers.

## Changed files

- `supabase/migrations/20261024110000_vat_wht.sql` adds fields, exact calculations, retained price mode, profile RPC, and forward replacements of quote/invoice guards, issue, and conversion functions. Existing applied migrations are unchanged.
- `supabase/tests/vat_wht.sql` covers inclusive/exclusive issue snapshots, rounding, mixed rates, discounts, frozen identity/totals, idempotency, quote conversion, empty drafts, and net verified settlement.
- `lib/tax/*`, `components/document-totals.tsx`, and `lib/documents/{invoice-snapshot,printable}*` own math and presentation.
- Finance business profile, invoice/quote line editors/actions, withholding form, detail/PDF pages, and client form/edit/actions persist and display the fields. Product option reads carry catalog tax defaults, including inline creation.
- `lib/supabase/read-all*`, `lib/queries/dashboard*`, Finance readers, `ee/portal/*`, and their fixtures cover pagination and net balances. `ee/accounting/*` and `lib/mcp/{data.mjs,tools.mjs,erp-server.test.ts}` preserve gross-total consumers.
- `lib/types/database.ts` includes the additive schema and RPC fields. `e2e/vat-wht.spec.ts` creates a VAT-registered invoice, selects WHT 3%, checks all totals, issues it, and checks PDF and portal output.

## Initial implementation verification

All four required gates exited 0 before the integration merge. Final output excerpts follow.

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  93 passed (93)
      Tests  698 passed (698)
   Start at  02:40:00
   Duration  7.20s

pnpm build
✓ Compiled successfully in 8.8s
  Finished TypeScript in 5.9s ...
✓ Generating static pages using 17 workers (20/20) in 320ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

`git diff --check` and `python3 .project-memory/read.py --check` also passed. `supabase/tests/vat_wht.sql` initially contained 42 pgTAP assertions; the integration round adds five balance-view assertions, for 47. Pure tests cover all allowed WHT rates, exclusive/inclusive and mixed VAT rates, discounts, half-up rounding, safe limits, and 6,250 bounded rounding combinations.

## Integration work left

SQL and Playwright execution are not run here. This dispatch forbids starting Supabase/Docker, and the worktree has no `.env.local` or `.local-stack/isolation.json`. The coordinator confirmed that it will apply the migration and run `supabase/tests/vat_wht.sql` and `e2e/vat-wht.spec.ts` at merge.

A read-only independent review approved the source diff and verified the no-line PDF correction. No provider sync, email delivery, tax filing, deployment, push, or merge was performed. No dependency was added. The Model the Domain principle led to one per-rate totals structure; Prove It Works led to tax, snapshot, pagination, gross/net mapping, and reader regression tests.


## Integration round on 2026-10-23

Merged `odoo-parity` at `2407c61` into the VAT/WHT branch. Conflicts in invoice detail, Finance list, quote detail, and database types preserve both tracks. VAT/WHT totals, selector, line tax columns, and tax RPC types coexist with exact linked-record counts, SQL balances, purchasing bill columns, completed-by attribution, lead forms, and the command palette.

The invoice Payments smart button uses a separate exact head count. Its displayed receipt list still paginates, and the verified paid total comes from `invoice_balances`. Quote linked-invoice counts retain their exact count and single-ID drill-through behavior. Finance keeps vendor/order links, bill number/date, due date, paid state, Mark paid, the costs tab URL, and complete cost reads.

All VAT/WHT paging now imports `lib/supabase/read-all.ts`. The duplicate `lib/queries/read-all.ts` and its redundant tests are removed. The purchasing adapter and palette verified-receipt reader also delegate to the shared helper, so this integration adds no paging loop. The helper preserves the inferred query error type without changing its runtime behavior.

The following readers were checked against the incoming integration branch.

| Checked reader | Verified contract |
| --- | --- |
| `supabase/migrations/20261023150000_client_balances.sql`, `invoice_balances` | Reads `invoices.amount_satang`; outstanding subtracts verified payments once. |
| Same migration, `client_balances` | Aggregates net collectible amounts and outstanding for issued invoices. No additional WHT subtraction. |
| `app/(app)/clients/[id]/page.tsx` | Uses the client view's net outstanding and exact related-record counts. |
| `app/(app)/finance/invoices/[id]/page.tsx` | Shows gross `total_satang`, WHT, and net `amount_satang`; paid total comes from the invoice view and payment count uses an exact head query. |
| `app/(app)/finance/page.tsx` | Receivables/status use net invoice amounts; verified cash uses payments. Purchasing bill amounts come from costs. |
| `lib/search/actions.ts` | Palette Pay availability and effective invoice status compare net invoice amount with all verified payments. |
| `lib/search/query.ts` and palette record search | Search invoice/quote numbers, not monetary totals. |
| `app/(app)/projects/[id]/page.tsx` | Incoming changes add exact linked counts and SQL time totals. Quote totals already use `quotes.total_satang`; invoice labels and the existing billed estimate retain their net amount contract. No new gross invoice reader is introduced here. |
| `app/(app)/finance/subscriptions/[id]/page.tsx` | Incoming invoice drill-through is an exact count; the amount is a subscription forecast, not an invoice gross total. |
| `app/(app)/dashboard/page.tsx`, `lib/queries/dashboard.ts` | Invoice overdue/unpaid remains net; cash revenue remains verified payments; new vendor-bill attention uses an exact cost count. |
| `lib/purchasing/queries.ts`, `lib/purchasing/rfq.ts`, purchase detail/list/PDF pages | Supplier totals use purchase line quantities and unit costs, not customer invoice amount columns. |
| `app/(app)/vendors/[id]/page.tsx`, purchase Bills component, Finance bill columns | Money owed is unpaid `costs.amount_satang`; customer invoice WHT is not applied to vendor costs. |
| `ee/accounting/{invoice-actions,mapping}.ts`, `lib/mcp/{data,tools}.mjs` | Rechecked after merge. Customer invoice gross totals use `total_satang`, while MCP unpaid still uses `amount_satang`. |

No new incoming reader interprets a net invoice column as a gross VAT-inclusive document total. Balance views remain unchanged. The tax SQL suite now asserts net invoice and client balances after a verified settlement.

`lib/documents/vat-pages.test.ts` covers merged invoice totals and WHT controls, a 1,501-payment count, a 1,001-invoice quote drill-through, and Finance vendor metadata on the second page. The tenant fixture now preserves exact counts when a returned list has a limit, matching PostgREST.

All integration gates exited 0 on the merged code, including the stricter exact-count fixture.

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  110 passed (110)
      Tests  782 passed (782)
   Start at  02:49:41
   Duration  4.18s

pnpm build
✓ Compiled successfully in 4.2s
  Finished TypeScript in 6.3s ...
✓ Generating static pages using 17 workers (22/22) in 213ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

Independent read-only review approved the resolved source against both parents and passed 6 focused files with 44 tests. Its fixture suggestion was applied; counts now require an explicit exact-count request. `git diff --check` and the memory reader check pass. Migrate Callers Then Delete Legacy APIs led to removing the duplicate pager; Prove It Works led to the merged-page regressions and stricter count fixture.

SQL and Playwright execution remain assigned to the coordinator; no local database or Docker startup occurred. No push, deployment, or merge into the integration/base branch was performed.
