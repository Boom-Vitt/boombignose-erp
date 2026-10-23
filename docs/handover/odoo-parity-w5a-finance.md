# W5-a finance corrections and customer credit

2026-10-23. Worktree `odoo-w5a-finance`, based on `odoo-parity` at `e5022f1`. Nothing was pushed or merged. The assigned isolated API is 55701 and app port is 3106.

## Delivered behavior

1. Issued invoices accept full or partial credit notes by original line quantity or entered amount. Notes have a transactional gap-free `CN-YYYY-NNNNNN` counter, immutable snapshot, original invoice link, reason, author and audit entry. Original invoice content stays frozen. Balances, effective status, PDFs, exports, palette, MCP and customer balances account for corrections. Registered original sellers print `Tax credit note / ใบลดหนี้` through the repository's self-contained print-to-PDF HTML route.
2. Receipt reversal retains the original verified cash and posts its signed offset. It reverses all allocations still funded by that receipt, including later applications, and recalculates every affected invoice. The command records its reason and posting date, enforces the finance lock, and admits one reversal under concurrent calls.
3. A reported customer receipt can reserve amounts on several invoices. Verification posts one cash entry and its allocations. Excess remains customer credit. Later application posts allocations only. Refunds post negative verified cash. Customer locks serialize reports, reviews, allocations, refunds, credit releases and reversal before invoice locks. The new page is `/finance/receipts`, linked from Finance and client details.
4. Deposits on mixed-rate quotes retain separate tax bucket lines. Final issue credits issued deposits by their original buckets, cancels unissued deposit drafts, and transfers released cash by funding receipt. No cash is received twice. Per-rate capacity checks protect deposits during partial invoicing. A corrected single-rate deposit is removed from the remaining final deduction.
5. Settings > Finance can require a different owner or admin to verify a receipt than the staff member who reported it. The default remains disabled. Rejection and failed verification create no cash.
6. The business profile offers `registered`, `not_registered` and `unknown`. The explicit status RPC preserves the existing generated `vat_registered` flag. The old boolean overload remains for compatibility with existing callers.

## Important contracts

Money stays integer satang. Partial correction tax is the difference between original and remaining rounded buckets, so successive credits exactly exhaust original VAT and WHT. Adopted legacy records use retained collectible amounts without certifying historical tax, including documents without priced lines.

`sum(payments.amount_satang) where verification_state='verified'` remains net settled cash. `payment_allocations` settles invoices. A paid invoice correction releases excess allocations into available customer credit. Refunds must be reversed before their source receipt can be reversed. Both actions preserve their original evidence.

Quote conversion, crediting a quote-sourced invoice, and final issue acquire the quote before the customer and invoice. Final mixed issue consumes its deposit reservation before auto-crediting or cancelling deposit drafts. A deposit reserved by a final draft cannot be independently credited until that draft is cancelled or issued. After issuing a single-rate final, both the deposit and final can be corrected within their original remaining amounts.

Browser financial commands keep their retry identity until acknowledgment. Acknowledged commands retire the key so a later intentional operation with identical details can proceed. New forms require durable browser retry storage. An uncertain response retains the exact request key.

## Files and database ownership

Migrations are `20261026090000_credit_notes.sql`, `20261026090500_payment_reversal.sql`, `20261026091000_customer_receipts.sql`, `20261026091500_mixed_deposits.sql`, `20261026092000_payment_review_policy.sql`, `20261026092500_explicit_vat_status.sql`, `20261026093000_credit_reporting.sql` and `20261026093500_deposit_correction_guards.sql`.

New tenant tables are `credit_notes` and `credit_note_lines`, both with forced RLS and read-only member policies. New security-invoker views are `customer_receipt_balances`, `invoice_receipts` and `credit_note_revenue`. `invoice_balances` and `client_balances` are replaced. Existing payments, claims and allocations gain customer/reversal/refund or multi-invoice fields. No external track-owned purchase, stock or subscription function is replaced.

Public commands created or replaced are `issue_credit_note`, `reverse_payment`, `submit_customer_payment_claim`, `apply_customer_credit`, `refund_customer_credit`, `submit_payment_claim`, `submit_internal_payment_claim`, `review_payment_claim_with_evidence`, `reconcile_legacy_payment_with_evidence`, `convert_accepted_quote`, `issue_invoice`, `update_payment_review_policy` and the explicit-status overload of `update_tax_business_profile`.

Private functions created or replaced are `retain_credit_note`, `invoice_settled_satang`, `refresh_invoice_status`, `credit_note_totals`, `guard_invoice_settlement`, `bind_payment_customer`, `lock_finance_customer`, `invoice_pending_satang`, `receipt_available_satang`, `validate_allocations`, `allocate_receipt`, `release_credited_allocations`, `review_customer_claim`, `quote_deposit_buckets`, `quote_rate_capacity` and `guard_payment_reviewer`. The original issue command moves to private `issue_invoice_document`, revoked from public callers, and the public wrapper retains its signature and grants.

UI and actions live in Finance correction/receipt controls, `/finance/credit-notes/[id]/pdf`, Finance settings and business profile. Shared math and readers are in `lib/tax`, `lib/payments`, `lib/documents`, `lib/metrics`, `lib/queries`, `lib/search` and `lib/mcp`. Quote, project, report and portal readers consume the corrected balances. Invoice CSV uses authoritative invoice balances, so a shared receipt cannot lose an allocation through row-ID deduplication.

## Verification evidence

Baseline full SQL passed 33 files and 1,047 assertions. New suites are `credit_notes.sql`, `payment_reversal.sql`, `payment_allocation.sql`, `mixed_deposits.sql`, `payment_review_policy.sql` and `vat_status.sql`. Existing balance, legacy upgrade and quote suites now use the allocation model and mixed-deposit contract.

Observed failing-then-passing checks include an extra VAT satang from independent credit rounding, historical credit balances remaining 900 and 800, a mixed deposit rejected by the old single-rate restriction, a corrected single-rate deposit deducted twice, unissued mixed-deposit cancellation blocked by the final reservation, and dashboard revenue failing to subtract credit bases. Browser tests also exercise intentional identical corrections, uncertain-response retries, review separation, refunds and reversal.

Run `node supabase/tests/payment-concurrency.test.mjs` from this worktree for actual competing PostgreSQL sessions followed by pgTAP assertions. It selects only the DB container published on the assigned API port plus one, checks one allocation winner and one reversal offset, then removes its synthetic workspace. The normal Supabase SQL runner runs the `.sql` suites; this separate concurrency driver must also be run.

Final gates ran sequentially on 2026-10-23 against API 55701 and app 3106. Every command exited 0.

| Order | Command | Observed result |
| --- | --- | --- |
| 1 | `.local-stack/db-reset.sh "$PWD"` | All 39 SQL files and 1,140 assertions passed. |
| 2 | `pnpm lint` | Passed with no errors or warnings. |
| 3 | `pnpm typecheck` | Passed. |
| 4 | `pnpm test` | All 152 files and 1,208 tests passed. |
| 5 | `pnpm build` | Production build passed. |
| 6 | `pnpm e2e` | Full suite passed with 52 passing tests and four expected Community skips. No timeouts or retries. |
| 7 | `pnpm lint` | Final lint passed with no errors or warnings. |
| 8 | `node supabase/tests/payment-concurrency.test.mjs` | All seven assertions passed against competing PostgreSQL sessions. |

Temporary command logs are `/tmp/w5a-resume-{sql,lint,typecheck,test,build,e2e,lint-final,concurrency}.log`. The final deposit regression has separate red and green evidence in `/tmp/w5a-deposit-{red,green}.log`. Required browser specs `e2e/credit-notes.spec.ts` and `e2e/payments-allocation.spec.ts` both passed in the full run, using `e2e/finance-fixture.ts`.

Independent source review approved the carried caller, export and retry changes plus the final deposit correction. The resumed review found that the deposit guard permanently blocked corrections after issuing a single-rate final. The regression failed with only 5,000 of 10,000 satang credited and 5,000 still outstanding. Restricting the guard to final drafts passes all 22 mixed-deposit assertions, including the draft-reservation rejection. The review also traced consumed quote quantities and found no path to bill that scope again. Independent review did not execute the owner-run runtime gates.

The resume replaced saved WIP commit `dc416cf` with logical commits `c5c0151` for corrected finance consumers, `6214899` for retry acknowledgment and browser coverage, and `f1ed901` for deposit corrections. All commits through `d398755` remain unchanged. A source-tree comparison confirmed the split preserved the tested implementation exactly. The Prove It Works principle required the real failing balance assertion and full runtime gates before completion.

## Limits

This uses the existing operational-document PDF convention and does not introduce a legal tax filing system. Historical adoption retains an amount-only correction contract because its original tax evidence was never certified. Single-rate final invoices retain the prior discount-deduction representation. Mixed-rate final invoices use linked credit notes.

No dependency was added. No other stack, deployment, push or base-branch merge was performed. No track implementation or validation work remains. The coordinator owns integration. The four expected Pro-only browser tests were skipped in Community.
