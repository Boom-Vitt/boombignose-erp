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

`lib/tax/totals.ts` uses bigint internally and returns safe integer satang to existing application readers. PostgreSQL uses exact `div()`/`mod()` integer arithmetic. Plain numeric `/` rounds its quotient, so it is not exact. Discount allocation uses proportional rate buckets and largest remainders, with ascending rate as the tie-break. Inclusive VAT is extracted after discount. Quotes have no WHT; converted invoice drafts can select it without changing accepted gross terms. Supported WHT rates are 0, 1, 2, 3, and 5 percent.

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
| Project billed-profit estimate | `total_satang - vat_satang` since `20261024110500_vat_wht_fixes.sql` landed, so withholding counts as revenue. Project invoice labels keep the net `amount_satang`. |

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

## E2E and review-fix round on 2026-10-23

The branch was fast-forwarded to `c211899` and runs on its own isolated Supabase stack (API 55901, app 3108). Four commits follow.

**E2E hang root cause (`5488109`).** The app was fine; the test selector was wrong. Playwright's `getByLabel` matches a wrapping `<label>` by its full text content, which includes the option labels (`Withholding tax0%1%2%3%5%`). `getByLabel("Withholding tax", { exact: true })` therefore never resolved, and `selectOption` waited until the test timed out. The DEBUG log shows it never printed "locator resolved to". The combobox's accessible name is exactly "Withholding tax", which is what the page snapshot showed. A `page.setContent` micro-repro confirmed it: the wrapped markup gave `getByLabel` exact 0 matches and `getByRole` 1, while `htmlFor` markup gave 1 for both. The spec now targets `getByRole("combobox", { name: "Withholding tax", exact: true })` and asserts `toHaveValue("300")` after the save and refresh, so the saved rate is checked. Behind the hang was a second failure. `/portal/<token>` 404s in community builds because `lib/edition/community.tsx` makes the portal Pro-only. Those assertions now run only when `community` from `e2e/edition.ts` is false, the same guard the other specs use. The spec passes in a community build (portal skipped) and in a `BBN_EDITION=pro` build (portal asserted).

**Review fixes (`205b061` failing tests first, then `a24459f` and `2e59534`; the row-cap test and fix follow).** These come from the Codex review of `w2d`.

1. `org_settings.vat_registered` is now `generated always as (tax_status='registered') stored`. Registered sellers from before VAT settings read as VAT registered, and the flag can no longer drift from `tax_status`. `update_tax_business_profile` stops writing the flag. An unchecked save keeps `unknown` rather than declaring `not_registered`, because the checkbox cannot express "unknown". Lines and snapshots are untouched. `lib/types/database.ts` marks the column `never` for Insert/Update.
2. `private.document_tax_totals` used `round(a/b)` and `floor(a/b)`. Postgres numeric `/` already rounds the quotient (here to 4 decimals), so the result was rounded twice. The reviewer's inclusive `1999900000000001` satang at 9999 bps gave SQL VAT `…001` against `…000` in TS. The discount allocation had the same flaw: a three-rate case moved one satang between rate buckets. The function now uses `div()`/`mod()` with half-up `div(2n+d,2d)`, the same arithmetic as `lib/tax/totals.ts`. `supabase/tests/vat_wht_fixes.sql` and `lib/tax/totals.test.ts` assert the same six edge cases with identical expectations, generated once from the TS helper. Before the fix, 4 of the 10 new SQL assertions failed (backfill, unknown status, and both divergent cases). After it, all pass. A 3,000-case random sweep of live SQL against TS found 0 mismatches. The same sweep also found 0 against the old function, so it only shows ordinary inputs did not regress. The constructed cases are the evidence for the fix.
3. `projectProfit` reads `total_satang - vat_satang`. The reviewer's case (exempt ฿1,000, 3% WHT, ฿500 cost) gave ฿470 before the fix and ฿500 after. Receivables keep `amount_satang`.
4. The project page summed profit from plain invoice and cost lists, which the API caps at 1,000 rows. Both now read through `readAllOrThrow`, so a failed page fails the request instead of showing a partial profit. The invoice smart-button count is the complete list's length. `lib/documents/vat-pages.test.ts` renders the page with 1,001 WHT invoices and 1,001 costs. Before the fix it showed ฿1,000.00 / ฿500.00 / ฿500.00, and after it ฿1,001.00 / ฿500.50 / ฿500.50.

**Verification.** All gates ran on the isolated stack.

```text
.local-stack/db-reset.sh
supabase/tests/vat_wht_fixes.sql ........... ok
All tests successful.
Files=16, Tests=330
Result: PASS

pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
 Test Files  111 passed (111)
      Tests  803 passed (803)

pnpm build
✓ Compiled successfully in 3.6s
✓ Generating static pages using 17 workers (22/22) in 152ms

pnpm e2e
  ✓  37 [chromium] › e2e/vat-wht.spec.ts:8:5 › VAT-registered invoice with WHT 3% freezes and presents the same totals (3.2s)
  4 skipped
  35 passed (37.9s)
```

The four skips are the existing Pro-only guards in a community build.

**Open issues.** These are known and out of scope.

- `private.document_tax_totals` changes results only for extreme inputs. A draft saved earlier with such values keeps its stored totals until its next edit, and `issue_invoice` rejects it until then. Issued snapshots made with the old arithmetic stay as issued.
- Dashboard invoice MRR (`lib/queries/dashboard.ts`) still sums the net `amount_satang` of recurring invoices, so WHT lowers it. The review did not flag it, and subscriptions remain the primary MRR. Owner call.
- The project page's billable time value still sums a plain `time_entries` list. That is pre-existing and outside this track, and it undercounts above 1,000 entries.
