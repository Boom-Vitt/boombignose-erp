# Wave 2a purchasing handover

Vendors now have searchable lists, create/detail/edit forms, linked order and bill counts, amount owed and record history. Purchase orders use the document counter, catalog cost snapshots, shared status controls and history, RFQ printing/email, confirmation, cumulative partial receipts and bills recorded in the existing costs ledger. Finance paginates costs before computing their totals and shows bill references, due dates and paid state, and dashboard attention includes an exact overdue vendor bill count.

## Data and invariants

- `supabase/migrations/20261024090000_purchasing.sql` adds vendors, purchase status, purchase orders and lines; extends costs and record history; applies forced RLS; adds staff-only atomic order, receipt and bill commands. Direct order writes are unavailable to authenticated callers. A private staff-scoped lock helper lets draft line writes serialize against commands without granting direct PO updates.
- Totals derive from lines. Exact rounding reuses `serviceLineAmount`, with integer satang bounds in SQL and TypeScript. `lib/purchasing/quantities.ts` exports the pure `applyReceipt` hook for the inventory wave. Inputs are cumulative received totals; movement quantities are the new totals minus the previous totals.
- `billed_quantity` tracks already billed receipts. Each bill charges the difference of rounded cumulative receipt amounts and previously billed amounts. Repeating a receipt target does not add quantities; repeating billing without new receipts returns the previous bill. Partial receipts and bills leave an order confirmed until full receipt/billing. Linked bill evidence is retained and immutable except for its initial paid timestamp.
- `supabase/seed.sql` appends two synthetic vendors and two catalog-backed orders, one received and one draft.

## Files

New code lives in `app/(app)/purchases/**`, `app/(app)/vendors/**` and `lib/purchasing/**`. Additive shared changes are in `components/nav.ts`, `lib/permissions.ts`, `lib/record/status.ts`, `lib/record-history/model.ts`, `lib/types/database.ts`, Finance costs and dashboard attention. Coordinator-approved facet integration extends `lib/search-facets.ts`, `app/(app)/views/actions.ts` and `app/(app)/views/save-view-button.tsx`; `view-config.ts` already accepts arbitrary string values and needed no change. The shared tenant test fixture gains the `is` filter and exact count result used by the dashboard count query.

## Verification

Executed in this worktree on 2026-10-23. All four source gates exited 0. Final relevant log lines were:

```text
pnpm lint
$ eslint

pnpm typecheck
$ tsc --noEmit

pnpm test
Test Files  95 passed (95)
Tests  662 passed (662)
Duration  8.99s

pnpm build
✓ Compiled successfully in 10.1s
Finished TypeScript in 8.3s ...
✓ Generating static pages using 17 workers (22/22) in 252ms
ƒ Proxy (Middleware)
ƒ  (Dynamic)  server-rendered on demand
```

A read-only gpt-6-astra review found and rechecked the lock-permission, external RFQ-content and Finance pagination corrections; it reported no further concrete code defects in the reviewed source. This is not merge approval. Two narration comments were removed and the receipt helper comment was narrowed to its public input contract.

Focused unit tests cover complete escaped RFQ content, exact PO totals, safe money limits, partial receipt math, retry behavior, incremental bill amounts, boundary validation, pagination beyond 1,000 rows and overdue bill count filtering/error handling. New `supabase/tests/purchasing.sql` contains 44 pgTAP assertions covering RLS, staff/member/anonymous permissions, cross-tenant references, counter behavior, receipt transitions, snapshots, billing and paid state. New `e2e/purchasing.spec.ts` creates a vendor and catalog-backed PO, confirms it, records two receipts and bills, then checks payment state in Finance.

SQL and browser runtime checks have not run here. `pnpm exec playwright test e2e/purchasing.spec.ts --list` stopped before test discovery with `ENOENT ... .local-stack/isolation.json`; `.env.local` is absent too. No Supabase or Docker service was started. The coordinator explicitly owns migration application, SQL tests and Playwright on the integration database and will request a fix round for failures.

## Open issues and next steps

Apply the migration before using these routes, then run the SQL and browser tests on the integration stack. Review enum/type additions together with sibling tracks when merging. RFQ printing reuses the quote printable renderer and supports browser Save as PDF. RFQ delivery reuses the existing email sender and includes every escaped line, quantity, cost, total and notes in the email body so external suppliers do not need workspace access; real email delivery was not exercised. The internal printable route stays authenticated. No inventory stock moves are written in this wave.
