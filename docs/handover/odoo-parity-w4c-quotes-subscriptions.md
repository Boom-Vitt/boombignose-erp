# W4c quotes and subscriptions

Verified on 2026-10-23 in the dispatched W4c worktree. This handover describes local changes. Nothing was pushed or deployed.

Initial code commits are `b164cab` for SQL and core types, `d858c9b` for quote controls, and `f889560` for recurring billing controls. Integration includes parser fix `2a31c8b`, merge `663bb49` at the requested integration base, and merge `e4482e5` of W4a fixture fixes at `c8be5f7`.

Quotes record acceptance time and portal signer name/email. Validity is checked when a sent quote is accepted. Accepted quotes can convert after expiry. App mutations share `record:write`, and acceptance also requires staff capability. Portal acceptance validates the token, records immutable identity, and writes an atomic reserved audit entry.

Conversion supports remaining or selected quantities and percentage or fixed deposits. Tenant-bound invoice line links reserve quote quantities. Cancelling a draft releases its quantities and deposit application atomically. Staff can cancel linked drafts from the quote page. Source invoices freeze after construction. Converted drafts use `DRAFT-<UUID>` references. Quote numbering uses `document_counters`. Line append positions use the maximum existing position, with parent locks in SQL and a duplicate-position repair in the migration.

Subscription edits use one definer command. Changing an unbilled start date resets the next run. Resume skips missed periods unless staff explicitly chooses to bill them. Generated invoices retain subscription VAT mode, tax/WHT rates, product, and unit. Creation defaults come from the product or organization. Cron paginates with `readAll`, logs each failed subscription with its reason, writes its audit entry, and continues the batch.

The command palette opens the quote's own invoice dialog. A pending conversion stores its exact payload and key per organization and quote in sessionStorage until its invoice redirect acknowledges success. Refresh, changed invoice progress, and changed form inputs reuse that command. New commands require a successful storage write and exact read-back; unavailable storage blocks submission. Confirmed SQL scope rejections release the command so users can correct input; uncertain results and permission/idempotency conflicts retain it. Quote counts, linked documents and active invoiced totals use complete paginated results.

Files are grouped by responsibility:

- `supabase/migrations/20261025100000_quotes_subscriptions.sql`, `supabase/tests/quotes_subscriptions.sql`, and `supabase/tests/service_expiry.sql` own schema, commands, guards, and database fixtures.
- `app/(app)/quotes/**`, `app/(app)/finance/invoice-items-actions.ts`, and `ee/portal/{actions.ts,components/accept-quote-button.tsx}` own quote, line, and portal behavior.
- `app/(app)/finance/subscription-actions.ts`, `finance/subscriptions/**`, `finance/_components/subscription-{form,controls}.tsx`, and `app/api/cron/subscriptions/route.ts` own recurring billing.
- `lib/types/database.ts`, `lib/workflows/service.ts`, `lib/workflows/quote-conversion-command.ts`, `lib/search/actions.ts`, and `components/command-palette/command-palette.tsx` contain the shared integration changes.
- `app/(app)/inventory/_components/forms.tsx` now accepts only the product fields used by replenishment, resolving the merged product withholding type mismatch. `e2e/tenant-onboarding.spec.ts` covers partial/deposit/cancel billing, dropped deposit responses with refresh and correction after rejection, and subscription resume/tax behavior.
- Focused regressions live in `lib/workflows/quote-parity-*.test.ts`, `service*.test.ts`, `lib/billing/subscription-*.test.ts`, and `lib/search/actions.test.ts`. Existing VAT, product-line, and invoice-line fixtures follow the changed query contracts.

Database function ownership is explicit. This migration creates or replaces:

```text
public.reserve_document_number
public.accept_portal_quote
public.cancel_quote_invoice
public.convert_accepted_quote
public.update_subscription_schedule
public.generate_subscription_occurrence
private.guard_quote_invoicing_fields
private.append_document_line_position
private.default_subscription_tax
private.subscription_invoice_tax_mode
private.guard_quote_record
private.guard_quote_line
private.guard_commercial_customer
private.guard_invoice_line
private.guard_quote_invoice_command
private.release_quote_invoice_quantities
private.guard_invoice_quote_item
private.guard_quote_audit_event
private.guard_subscription_schedule
```

The coordinator explicitly assigned the two shared invoice source guards to W4c. Every existing tax, payment-evidence, and issued-content check remains. This migration does not redefine `issue_invoice`, payment commands, or invoice issue/numbering guards. Subscription VAT mode uses a separate trigger after the existing document-default trigger.

Model the Domain guided the choice to retain delivery quantity on quote-linked invoice lines and monetary deposit balances on invoice headers. No new table or npm dependency was added. The local decision trail is `.audit/w4c-quotes-subscriptions.tsv`; project memory follows the repository's ignored `.project-memory/` convention.

Runtime integration reproduced the CLI migration parse failure and fixed it by computing the conditional deposit deduction before the IF expression. The initial inspection-only SQL review missed that defect. The private idempotency-ledger assertion now temporarily resets its test role; production grants were not broadened. Merged finance lifecycle guard messages are reflected in the W4c fixtures.

The coordinator's final rounding decision supersedes the original hard quote-total reconciliation: every partial, deposit and final invoice uses the unchanged standard tax helper on its own lines. No zero-rated rounding line, custom tax adjustment field/helper, snapshot extension, or issue/payment function change remains. Two single-unit invoices at 10,005 satang exclusive 7% each have VAT 700; aggregate VAT 1,400 can differ from quote VAT 1,401. The quote page shows “Invoiced vs quote”, the difference, and the independent-rounding explanation. Accepted quantities, quote discount and deposit deduction remain enforced.

Observed red then green regressions cover migration application, the private-ledger test role, split VAT behavior (exclusive, inclusive and discounted deposit/rebilling), refreshed command identity, blocked storage, and correction after confirmed rejection. Independent review approved the current patch by inspection after two recovery findings were fixed; it did not claim to run the parent-owned database/browser gates.

Final integration commits include `05259b0` (independent split VAT and comparison), `5bd25e0` (persistent command recovery), and `cf5c3a9` (replenishment input type). All required gates exited 0 on the tested patch. The assigned reset applied every migration and seed before the browser run; no other stack was used. Final output excerpts:

```text
.local-stack/db-reset.sh "$PWD"
All tests successful.
Files=24, Tests=749
Result: PASS
exit 0

pnpm lint
$ eslint
exit 0

pnpm typecheck
$ tsc --noEmit
exit 0

pnpm test
 Test Files  134 passed (134)
      Tests  1006 passed (1006)
exit 0

pnpm build
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
exit 0

pnpm e2e
  4 skipped
  44 passed (1.5m)
exit 0
```

The SQL suite includes all 111 W4c assertions, `service_expiry.sql` and `service_rollback.sql`; W4a finance/time/VAT fixtures also pass. Browser skips are the four existing Pro-only cases in the Community build: payment portal, workspace switcher, extra workspace provisioning and accounting integration. Migration replay, SQL/RLS assertions and actual quote/subscription browser interactions are now runtime verified; this supersedes the original handover's unexecuted SQL/browser checks. `git diff --check` and the project memory check also pass. Logs are `/tmp/w4c-final-{reset,sql,lint,typecheck,unit,build,e2e}.log`; final results are pasted here so the handover does not depend on temporary logs.

No unresolved integration failure remains. No screenshots were required, no new dependency was installed, and nothing was pushed or deployed.

Deposits require one accepted tax rate; the coordinator deferred mixed-rate deposits to the credit work. Ordinary partial invoices support mixed rates. Deposit percentages use entered line prices after quote discount, so inclusive agreements use an inclusive deposit amount. A 100% deposit can produce a zero-value final bookkeeping draft; the existing issue command does not issue a zero-payable document. Browser storage must be available to start a recoverable conversion.
