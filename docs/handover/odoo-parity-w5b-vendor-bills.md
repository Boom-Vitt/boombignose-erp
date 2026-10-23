# Vendor invoice matching for W5b

2026-10-23. Base integration revision `e5022f1`. This track owns vendor bill commands and cost guards. It does not replace receiving, returns, stock posting, invoice issuance, payments, or business-profile commands.

## Vendor invoice evidence and money

Purchasing now matches the vendor's reference, bill date, due date, line quantities, unit costs, input VAT rate and amount, and gross total. Defaults use unbilled received quantities at the PO cost. Due dates use the vendor's payment terms from the bill date. The user can edit the due date.

`vendor_bill_matches` is immutable evidence with forced tenant RLS. Its unique index covers organization, vendor, and the trimmed case-insensitive vendor reference. The database refuses duplicates, including competing commands for different POs. An invoice can create inventory and other cost rows under one matching record. The evidence record does not store money totals.

`costs.amount_satang` remains the sole recorded money-out amount. It now contains the vendor's gross payable amount, including input VAT. `input_vat_satang` records the VAT portion, and Finance displays both fields. Existing burn and money-out readers therefore include gross recorded costs. Inventory costs retain category `inventory`, so the established exclusion from operating costs remains. The monthly purchase VAT view includes inventory purchases.

Matching retains typed JSON line evidence for entered and expected quantities, vendor and PO prices, the matched base, and category. Accepting a quantity variance consumes the current net received baseline, as the previous bill command did. Entered vendor quantities remain evidence rather than changing physical receipts. Partial receipt bills retain the difference of rounded cumulative PO amounts, avoiding a repeated half-satang charge.

Quantity and unit-price differences above `org_settings.bill_variance_tolerance_bps` require a reason. The default is 100 basis points, or 1 percent. Finance settings lets staff change the tolerance. Existing staff RLS protects that setting. Declared VAT or total discrepancies always require a reason. The command retains the reason and flags, applies the existing finance date lock, and audits the match. Safe integer satang bounds and exact category allocations are enforced.

## Return credits

The existing `return_purchase_order` still creates the negative PO-cost rows and owns physical return behavior. `link_vendor_credit` attaches one unpaid negative cost to a unique vendor credit reference and an original matched invoice from the same vendor and PO. The form accepts a credit date, VAT rate, VAT amount, and discrepancy reason. The command subtracts VAT from the negative gross cost. Credits reverse input VAT in the credit month. Original-invoice locking and the remaining VAT ceiling prevent repeated credits from reversing more VAT than the original invoice.

Legacy bills and credits retain their existing fields. The migration invents no historical vendor references. Credit linking requires an original invoice matched by the new command. Credit price adjustments beyond the pre-existing PO-cost return base are not included in this track.

## Database functions and compatibility

| Function | Change |
| --- | --- |
| `public.bill_purchase_order(uuid,uuid)` | Removed. The evidence-free overload cannot remain as a bypass. |
| `public.bill_purchase_order(uuid,uuid,jsonb)` | Created. Staff-only atomic matching, reference uniqueness, receipt snapshot validation, variances, VAT, category costs, audit, and PO status. |
| `private.guard_vendor_bill()` | Replaced. Retains linked cost immutability and payment-only updates, and rejects forged VAT or match fields on manual costs. |
| `public.link_vendor_credit(uuid,uuid,jsonb)` | Created. Links an existing negative return cost to vendor evidence, enforces original invoice and VAT limits, and audits the link. |

`bill_purchase_order` takes `p_org_id`, `p_order_id`, and `p_bill`. JSON fields are `vendor_reference`, `bill_date`, optional `due_date`, `input_vat_rate`, `input_vat_satang`, `vendor_total_satang`, optional `variance_reason`, and optional `lines`. Each entered line has `id`, `quantity`, `expected_quantity`, and `unit_cost_satang`. Omitting lines uses the current default receipt baseline. The app always sends explicit lines and dates. Monetary JSON fields are integer satang, while the VAT rate is a percentage with at most two decimals.

The credit command takes `p_org_id`, `p_cost_id`, and `p_bill`. Credit JSON uses `vendor_reference`, `bill_date`, `input_vat_rate`, `input_vat_satang`, `variance_reason`, and `original_bill_id`. Credit VAT is entered positively and stored negatively on the cost. No other track-owned function is redefined.

## Files and user-visible changes

- `supabase/migrations/20261026100000_vendor_bill_matching.sql` owns the evidence table, cost fields, commands, guard, and `monthly_purchase_vat` view.
- `lib/purchasing/bill-matching.ts` owns pure matching and due-date math. Its Vitest tests cover defaults, tolerances, zero prices, rounding, and invalid data.
- `lib/purchasing/schema.ts`, purchasing actions, and database types define the validated app boundary. Existing SQL purchasing fixtures now send complete invoice evidence through test-only helpers.
- Purchasing bill and credit forms, PO details, vendor bills, and Finance display vendor references and VAT. Finance settings adds the tolerance form.
- Reports and printable reports show monthly purchase base, input VAT, and gross vendor total. Cost CSV includes vendor invoice and VAT fields, and now uses the existing complete-row reader.
- `supabase/tests/vendor_bills.sql` and `e2e/vendor-bills.spec.ts` cover the new contract. Existing purchasing e2e and typed cost/report fixtures were updated.

## Verification evidence

The final code passed these gates on 2026-10-23.

| Gate | Result |
| --- | --- |
| `pnpm lint` | Passed. A concurrent attempt encountered Playwright deleting `test-results`; the serial retry passed. |
| `pnpm typecheck` | Passed. |
| `pnpm test` | 151 files and 1201 tests passed. |
| `pnpm build` | Passed with this worktree's isolated environment. |
| `.local-stack/db-reset.sh "$PWD"` | Full reset and SQL suite passed, 34 files and 1090 assertions. |
| `pnpm e2e` | Full production browser run passed, 50 tests passed and 4 expected Community skips. |
| `git diff --check` | Passed. |
| `python3 .project-memory/read.py --check` | Passed, 9 files checked. |

The dedicated browser test also runs two concurrent bill commands on separate POs with the same vendor reference. Exactly one succeeds, the other reports the duplicate, and only one cost is created. The existing purchasing browser test still verifies partial receipts, cumulative bill rounding and paid/unpaid presentation.

Core purchasing matching is committed as `c64b0f4`. Finance and reporting are a separate follow-up commit.

Observed red-to-green evidence includes a missing matching module before the pure implementation, failed legacy cost fixtures before adding the new VAT fields, browser locator and currency-format failures before correcting their assertions, and a database credit-VAT regression that accepted 71 satang against an original 70-satang invoice before the ceiling was added. The credit regression observed the incorrect stored amount of -171 and VAT of -71, rather than the intended -107 and -7.

The isolated reset command is `.local-stack/db-reset.sh "$PWD"`. Its historical directory name is `odoo-w2d-db`. The coordinator confirmed exclusive assignment to this track, and its config was inspected for API 55901 and DB 55902. App tests use port 3108. Environment and isolation files remain ignored.

Model the Domain selected one invoice evidence record for several category costs. Prove It Works required database assertions and a real production browser run. The one-worker decomposition keeps the coupled command, form, and report changes together. Independent integration review remains with the coordinator. No push, merge, external publication, or independent-review approval is claimed.
