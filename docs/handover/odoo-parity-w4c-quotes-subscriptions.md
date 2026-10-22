# W4c quotes and subscriptions

Verified on 2026-10-23 in the dispatched W4c worktree. This handover describes local changes. Nothing was pushed or deployed.

Code commits are `b164cab` for SQL and core types, `d858c9b` for quote controls, and `f889560` for recurring billing controls.

Quotes record acceptance time and portal signer name/email. Validity is checked when a sent quote is accepted. Accepted quotes can convert after expiry. App mutations share `record:write`, and acceptance also requires staff capability. Portal acceptance validates the token, records immutable identity, and writes an atomic reserved audit entry.

Conversion supports remaining or selected quantities and percentage or fixed deposits. Tenant-bound invoice line links reserve quote quantities. Cancelling a draft releases its quantities and deposit application atomically. Staff can cancel linked drafts from the quote page. Source invoices freeze after construction. Converted drafts use `DRAFT-<UUID>` references. Quote numbering uses `document_counters`. Line append positions use the maximum existing position, with parent locks in SQL and a duplicate-position repair in the migration.

Subscription edits use one definer command. Changing an unbilled start date resets the next run. Resume skips missed periods unless staff explicitly chooses to bill them. Generated invoices retain subscription VAT mode, tax/WHT rates, product, and unit. Creation defaults come from the product or organization. Cron paginates with `readAll`, logs each failed subscription with its reason, writes its audit entry, and continues the batch.

The command palette opens the quote's own invoice dialog. It no longer submits a conversion with a permanent quote-only key. Quote invoice counts, linked documents, and conversion revision keys read complete paginated results.

Files are grouped by responsibility:

- `supabase/migrations/20261025100000_quotes_subscriptions.sql`, `supabase/tests/quotes_subscriptions.sql`, and `supabase/tests/service_expiry.sql` own schema, commands, guards, and database fixtures.
- `app/(app)/quotes/**`, `app/(app)/finance/invoice-items-actions.ts`, and `ee/portal/{actions.ts,components/accept-quote-button.tsx}` own quote, line, and portal behavior.
- `app/(app)/finance/subscription-actions.ts`, `finance/subscriptions/**`, `finance/_components/subscription-{form,controls}.tsx`, and `app/api/cron/subscriptions/route.ts` own recurring billing.
- `lib/types/database.ts`, `lib/workflows/service.ts`, `lib/search/actions.ts`, and `components/command-palette/command-palette.tsx` contain the shared integration changes.
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

Verification includes observed failing then passing tests for acceptance retries, quote permissions, numbering and positions, conversion input, portal identity, recurring scheduling/defaults, cron failures, draft cancellation, and palette expiry/permissions. Independent app review checked the current diff and resolved its cancellation, stale-key, legacy-unit, and length-limit findings. SQL review inspected the migration and exercised the settlement arithmetic against the existing tax helper.

The four required local gates passed. Final output excerpts follow.

```text
pnpm lint
$ eslint
exit 0

pnpm typecheck
$ tsc --noEmit
exit 0

pnpm test
 Test Files  123 passed (123)
      Tests  930 passed (930)
exit 0

pnpm build
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
exit 0
```

`git diff --check` and `python3 .project-memory/read.py --check` passed. The SQL fixture contains 104 assertions. Database replay, pgTAP execution, concurrency/RLS runtime checks, and browser interaction were not run. The dispatch prohibits starting Supabase or Docker; the coordinator owns integration database application and the authored pgTAP fixtures.

Deposits require one accepted tax rate. The coordinator approved this scope and deferred mixed-rate deposits to the credit work. Ordinary partial invoices support mixed tax rates. Deposit percentages use entered line prices after quote discount, so VAT-inclusive agreements use an inclusive deposit base. Final settlement reconciles integer VAT rounding with the same tax calculator used at issue and enforces the accepted gross total. A 100% deposit can produce a zero-value final bookkeeping draft; the existing issue command does not issue a zero-payable document.
