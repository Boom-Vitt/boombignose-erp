# Vendor invoice matching for W5b

2026-10-23. Base integration revision `e5022f1`. This track owns vendor bill commands and cost guards. It does not replace receiving, returns, stock posting, invoice issuance, payments, or business-profile commands.

## Vendor invoice evidence and money

Purchasing now matches the vendor's reference, bill date, due date, line quantities, unit costs, input VAT rate and amount, and gross total. Defaults use unbilled received quantities at the PO cost. Due dates use the vendor's payment terms from the bill date. The user can edit the due date.

`vendor_bill_matches` is immutable evidence with forced tenant RLS. Its unique index covers organization, vendor, and the trimmed case-insensitive vendor reference. The database refuses duplicates, including competing commands for different POs. An invoice can create inventory and other cost rows under one matching record. The evidence record does not store money totals.

`costs.amount_satang` remains the sole recorded money-out amount. It now contains the vendor's gross payable amount, including input VAT. `input_vat_satang` records the VAT portion, and Finance displays both fields. Burn and money-out readers retain gross recorded costs. Finance operating expenses and project profit deduct input VAT only when org_settings.vat_registered is true; their queries now fetch that setting and the VAT field. Inventory costs retain category `inventory`, so the established exclusion from operating costs remains. The monthly purchase VAT view includes inventory purchases.

Matching retains typed JSON line evidence for entered and expected quantities, vendor and PO prices, the matched base, and category. Accepting a quantity variance consumes the current net received baseline, as the previous bill command did. Entered vendor quantities remain evidence rather than changing physical receipts. Partial receipt bills retain the difference of rounded cumulative PO amounts, avoiding a repeated half-satang charge.

Quantity and unit-price differences above `org_settings.bill_variance_tolerance_bps` require a reason. The default is 100 basis points, or 1 percent. Finance settings lets staff change the tolerance. Existing staff RLS protects that setting. VAT must agree with the matched base and declared rate within three satang per line; zero-rate VAT is zero. Gross total must equal matched base plus VAT. A reason permits quantity and price variances, never contradictory VAT or hidden total adjustments. The command retains the reason and flags, applies the existing finance date lock, and audits the match. Safe integer satang bounds and exact category allocations are enforced.

## Return credits

The existing `return_purchase_order` creates PO-price category credits and retains ownership of physical stock posting. `link_vendor_credit` selects one or more complete unpaid return costs and explicit allocations to one or more original bills of the same vendor and PO. A single immutable credit match covers every selected category and original, retains one vendor reference, and allocates VAT atomically. Linking uses each original line's accepted billed base over its physical received quantity, with cumulative rounding so a full return reverses the exact billed base.

Per-line cumulative limits cover each original invoice and all credited returns on the PO. Credit eligibility counts returned billed units, excluding returns of unbilled receipts even when the PO price is zero. The command serializes on the PO, locks originals and costs in deterministic order, validates all selected costs and dates before writing, and rejects UUID aliases. It checks every source cost's incurred and bill dates as well as the new date against the finance lock.

Credit VAT uses each original invoice's immutable rate and cumulative VAT allocation, preventing partial notes from consuming tax early or stranding a rounding remainder. The original invoice VAT must itself satisfy the matched base/rate rounding bound. Separate category/rate cost buckets share the same credit match when originals have different rates. Input credit VAT is a positive total; costs store allocated VAT negatively. The form displays original rates and each line's remaining billed and returned quantities.

The W5-b cost insertion trigger records exact billed return quantities in the select-only, tenant-scoped `vendor_return_credit_sources` table. It observes W5-d's completed item updates without changing any W5-d function. The linking allocations must exactly cover the selected source quantities. This supports arbitrary whole-cost groups even when fractional rounding produces zero-value PO credits. Quantities are evidence only; all money remains in costs.

Canonical `credit_request` evidence sorts UUID identities and normalizes dates, quantities, references and reasons. An identical retry returns the existing match, including a competing request that waited for the PO transaction. Changed evidence is refused. Retrying never creates additional credits, VAT rows or inventory adjustments.

For inventory, linking inserts a separate nonpayable `return_adjustment` for the matched-price difference. It never rewrites W5-d's adjustment row or changes stock moves. Signed credit base plus all return adjustments remains the negative stock value removed; recoverable VAT is a separate amount. Service credits fully cancel their billed base without stock adjustments.

Legacy bills retain their existing fields. No historical vendor references or per-cost returned quantities are invented. Source costs created before the quantity-capture migration require reconciliation before linking. If earlier bills or credits on a PO lack provenance, later returns still work, but the trigger conservatively skips capture and linking requires reconciliation. Empty credit-line evidence, inconsistent historical bill bases and implausible historical VAT are also refused. These safeguards do not repair preexisting inconsistent records automatically. The command consumes complete selected source costs; it does not split an individual source cost between separate credit notes.

## Database functions and compatibility

| Function | Change |
| --- | --- |
| `public.bill_purchase_order(uuid,uuid)` | Removed. The evidence-free overload cannot remain as a bypass. |
| `public.bill_purchase_order(uuid,uuid,jsonb)` | Created. Staff-only atomic matching, reference uniqueness, receipt snapshot validation, variances, VAT, category costs, audit, and PO status. |
| `private.guard_vendor_bill()` | Replaced. Retains linked cost immutability and payment-only updates, and rejects forged VAT or match fields on manual costs. |
| `public.link_vendor_credit(uuid,uuid,jsonb)` | Replaced in migrations `20261026103000` and `20261026104000`. The final version normalizes single/multiple originals into one allocation path, validates quantities/base/VAT/source periods, posts inventory price reconciliation and rate buckets, audits sources, and returns existing evidence for exact retries. |
| `private.capture_vendor_return_credit_source()` | Created in `20261026104000`. An after-insert cost trigger captures exact billed return quantities without replacing W5-d return or stock functions. |

`bill_purchase_order` takes `p_org_id`, `p_order_id`, and `p_bill`. JSON fields are `vendor_reference`, `bill_date`, optional `due_date`, `input_vat_rate`, `input_vat_satang`, `vendor_total_satang`, optional `variance_reason`, and optional `lines`. Each entered line has `id`, `quantity`, `expected_quantity`, and `unit_cost_satang`. Omitting lines uses the current default receipt baseline. The app always sends explicit lines and dates. Monetary JSON fields are integer satang, while the VAT rate is a percentage with at most two decimals.

The credit command takes `p_org_id`, `p_cost_id`, and `p_bill`. Credit JSON uses `vendor_reference`, `bill_date`, positive `input_vat_satang`, optional `variance_reason`, optional `cost_ids` (defaults to the anchor), and `allocations: [{original_bill_id, lines: [{id, quantity}]}]`. The app validates and normalizes legacy `original_bill_id`/`lines` input to one allocation. The SQL boundary also accepts that legacy shape and verifies an optional legacy `input_vat_rate` against the originals. New UI input derives rates from the originals. Stored credit lines retain original ID, quantity, matched base, category, rate and allocated VAT; the top-level `original_bill_id` is populated only for a single original. No other track-owned function is redefined.

## Files and user-visible changes

- `supabase/migrations/20261026100000_vendor_bill_matching.sql` owns the original evidence table, cost fields, commands, guard, and `monthly_purchase_vat` view. It is unchanged. `20261026103000_vendor_bill_review_fixes.sql` replaces only the W5-b bill and credit commands. `20261026104000_vendor_credit_allocations.sql` adds source quantity evidence, canonical credit requests and the final allocation command.
- `lib/purchasing/bill-matching.ts` owns pure matching and due-date math. Its Vitest tests cover defaults, tolerances, zero prices, rounding, and invalid data.
- `lib/purchasing/schema.ts`, purchasing actions, and database types define the validated app boundary. Existing SQL purchasing fixtures now send complete invoice evidence through test-only helpers.
- Purchasing bill and credit forms, PO details, vendor bills, and Finance display vendor references and VAT. Finance settings adds the tolerance form.
- Reports and printable reports show monthly purchase base, input VAT, and gross vendor total. Cost CSV includes vendor invoice and VAT fields, and now uses the existing complete-row reader.
- `lib/purchasing/credit-matching.ts` validates immutable line evidence and computes per-original remaining quantities in integer thousandths for the form.
- `supabase/tests/vendor_bills.sql`, `vendor_bill_review.sql`, `vendor_credit_allocations.sql`, `vendor_credit_concurrency.sql` and `e2e/vendor-bills.spec.ts` cover matching and credits. The concurrency test uses two real local database sessions with committed disposable fixtures and explicit cleanup; it reconnects as the isolated Supabase administrator only to establish those sessions. Existing purchasing e2e and typed cost/report fixtures were updated.

## Original implementation verification evidence

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

Model the Domain selected one invoice evidence record for several category costs. Prove It Works required database assertions and a real production browser run. The original implementation kept the command, form, and report changes within one worker. The resumption assigned SQL and UI to separate owned paths, with root integration and a fresh read-only reviewer. Independent integration review remains with the coordinator. No push, merge, external publication, or merge approval is claimed.

## Review-fix validation, 2026-10-23

The review fixes address all seven findings. The spurious tolerance field was removed from invoice-item, invoice and subscription Row/Insert/Update types; only org_settings retains it. The credit form submits explicit quantities and selected category costs from the PO; vendor pages link to the PO for this operation.

| Fix1 item | Result and regression coverage |
| --- | --- |
| 1. Recoverable input VAT in profit | Finance/project readers fetch VAT registration and input VAT; registered expenses deduct VAT, cash/burn remain gross. `lib/metrics/{finance,projects}.test.ts`, `lib/documents/vat-pages.test.ts`, dashboard regression. |
| 2. Implausible VAT with a reason | VAT is bounded by accepted base/rate and three satang per line; gross equals base plus VAT. Matching Vitest and `vendor_bill_review.sql`. |
| 3. Matched-price return credits | Per-original cumulative quantities allocate matched bases and VAT exactly; inventory reconciliation remains separate from stock posting. Review and allocation pgTAP suites. |
| 4. Mixed categories under one note | One match/reference groups all selected category/rate costs atomically. Review/allocation pgTAP and browser coverage. |
| 5. Locked source period | Source incurred/bill dates and the new credit date are checked before writes. Review/allocation pgTAP tests assert unchanged rejected sources. |
| 6. UUID aliases and eligible line set | SQL compares UUID identities and exact eligible bill lines; the app also compares UUID identities. Review pgTAP and matching/schema Vitest tests. |
| 7. Incorrect tolerance type fields | Removed from invoice item, invoice and subscription Row/Insert/Update types; retained only on org_settings. Source inspection and typecheck. |

Retained failing evidence includes the original 27 SQL regression failures, incorrect profit costs of 85,600 instead of 80,000 and 95,600 instead of 90,000, UUID-alias matching, a three-satang full-return VAT residual, and over-crediting five units when only two billed units were returned on a zero-price PO. The focused SQL file passes 50 assertions, including skewed multi-line VAT rounding and grouped same-category returns. During resumption, the seven-item patch passed a fresh full SQL reset (35 files / 1140 assertions), lint, typecheck, 151 files / 1207 Vitest tests, build, full e2e (50 passed / 4 expected skips), then lint. No browser timeout occurred in that run.

Read-only resumption review then found a combined return spanning two partial-receipt bills that could not link to either original. A direct SQL reproduction failed both the five-unit and ten-unit expected-success cases. The coordinator explicitly expanded this dispatch to multi-original allocation. New regression commits `a1f4604` and `b3b7ad1` precede implementation commits `0e1b203` and `8fbab93`. The new focused allocation suite went from 14 failures to 29 passing assertions, app/schema/action tests passed 26 assertions, and the concurrency suite passed all six assertions.

The final extended patch passed these gates sequentially on 2026-10-23. Each command exited 0. Logs remain in this worktree's ignored `.audit/` directory.

| Gate | Final result | Evidence file |
| --- | --- | --- |
| `.local-stack/db-reset.sh "$PWD"` | Full reset and SQL suite, 37 files and 1175 assertions passed. | `w5b-multi-sql-final.log` |
| `pnpm lint` | Passed before the browser run. | `w5b-multi-lint.log` |
| `pnpm typecheck` | Passed. | `w5b-multi-typecheck.log` |
| `pnpm test` | 152 files and 1214 tests passed. | `w5b-multi-test.log` |
| `pnpm build` | Passed with the assigned isolated environment. | `w5b-multi-build.log` |
| `pnpm e2e` | Full production run, 51 passed and 4 expected Community skips. Both vendor-bill browser flows passed. No test timed out, so no timeout isolation retry was needed. | `w5b-multi-e2e.log` |
| `pnpm lint` | Passed after the full browser run. | `w5b-multi-lint-final.log` |

`git diff --check` and the nine-file project memory check also passed. A fresh read-only review of `0e1b203` and `8fbab93` found no blocking correctness defect in the allocation command, source trigger, UI or tests. This is source-review evidence, not integration or merge approval. Historical returns without source quantities and partial consumption of one source cost remain the explicit limits described above. No requested implementation or validation work remains in this dispatch.

Model the Domain kept one invoice or credit evidence record for several category costs. Prove It Works required failing-then-passing pgTAP/Vitest checks plus production browser validation. Independent integration review and merge remain the coordinator's responsibility. No push or merge is authorized.
