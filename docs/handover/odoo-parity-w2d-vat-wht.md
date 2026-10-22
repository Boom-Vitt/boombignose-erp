# VAT and withholding document calculations

2026-10-23. The track adds quote/invoice VAT, invoice withholding, immutable issued totals, Finance profile defaults, buyer tax ID/branch fields, and matching portal and printable totals. README's operational-only stance remains. UI help states this is not a legal tax system, ledger, tax filing service, or e-Tax Invoice.

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
| Client balance view from t1 | Coordinator confirms `20261023150000_client_balances.sql` reads `amount_satang`. That migration is absent from this worktree and needs no tax subtraction on merge. |
| Portal | Stored subtotal/VAT/gross/WHT/net fields and verified receipts for outstanding. Reads paginate and fail closed. |
| Draft invoice PDF | Stored header totals; synthetic no-line fallback uses retained subtotal before discount. Title is `Invoice`. |
| Issued invoice PDF | Frozen snapshot. `Tax Invoice / ใบกำกับภาษี` only for seller VAT registration frozen at issue; seller/buyer tax IDs and branches retained. |
| Quote detail/PDF/portal and quote conversion | `quotes.total_satang` remains gross including VAT. |
| Accounting provider `totalBaht` and MCP `invoiced_total_satang` | `total_satang`, with legacy fixture fallback. MCP unpaid continues using net `amount_satang`. |
| Existing project billed-profit estimate and project invoice labels | Continue reading `amount_satang`. This is an existing billed estimate, not verified cash revenue; project/facet work is outside this track. |

Financial reads in the dashboard, Finance list/detail/export, PDF routes, and portal use `lib/queries/read-all.ts`, with stable unique ordering and pages below the API cap. Quote/invoice draft numbering scans also paginate. A failed later page discards partial financial data. Other tracks retain ownership of their readers.

## Changed files

- `supabase/migrations/20261024110000_vat_wht.sql` adds fields, exact calculations, retained price mode, profile RPC, and forward replacements of quote/invoice guards, issue, and conversion functions. Existing applied migrations are unchanged.
- `supabase/tests/vat_wht.sql` covers inclusive/exclusive issue snapshots, rounding, mixed rates, discounts, frozen identity/totals, idempotency, quote conversion, empty drafts, and net verified settlement.
- `lib/tax/*`, `components/document-totals.tsx`, and `lib/documents/{invoice-snapshot,printable}*` own math and presentation.
- Finance business profile, invoice/quote line editors/actions, withholding form, detail/PDF pages, and client form/edit/actions persist and display the fields. Product option reads carry catalog tax defaults, including inline creation.
- `lib/queries/{read-all,dashboard}*`, Finance readers, `ee/portal/*`, and their fixtures cover pagination and net balances. `ee/accounting/*` and `lib/mcp/{data.mjs,tools.mjs,erp-server.test.ts}` preserve gross-total consumers.
- `lib/types/database.ts` includes the additive schema and RPC fields. `e2e/vat-wht.spec.ts` creates a VAT-registered invoice, selects WHT 3%, checks all totals, issues it, and checks PDF and portal output.

## Verification

All four required gates exited 0 on the final code. Final output excerpts follow.

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

`git diff --check` and `python3 .project-memory/read.py --check` also passed. `supabase/tests/vat_wht.sql` contains 42 pgTAP assertions. Pure tests cover all allowed WHT rates, exclusive/inclusive and mixed VAT rates, discounts, half-up rounding, safe limits, and 6,250 bounded rounding combinations.

## Integration work left

SQL and Playwright execution are not run here. This dispatch forbids starting Supabase/Docker, and the worktree has no `.env.local` or `.local-stack/isolation.json`. The coordinator confirmed that it will apply the migration and run `supabase/tests/vat_wht.sql` and `e2e/vat-wht.spec.ts` at merge.

A read-only independent review approved the source diff and verified the no-line PDF correction. No provider sync, email delivery, tax filing, deployment, push, or merge was performed. No dependency was added. The Model the Domain principle led to one per-rate totals structure; Prove It Works led to tax, snapshot, pagination, gross/net mapping, and reader regression tests.
