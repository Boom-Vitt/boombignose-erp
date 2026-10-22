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

## Fix round 1, 2026-10-23

The coordinator confirmed the original migration and its 44 purchasing assertions pass on the integration database. This round adds `20261024090500_purchasing_fixes.sql`; the applied `20261024090000_purchasing.sql` is unchanged.

The child-line guard now permits privileged cascade deletion when its parent PO has already been removed, preserving ordinary tenant, staff and draft guards. `supabase/tests/purchasing_fixes.sql` adds 54 assertions for PO deletion, organization cascade, claim/finish permissions, invalid recipients, immutable snapshots, one delivery authorization, delivery outcomes and a 1,001-line RFQ snapshot.

RFQ sending now claims the draft and changes it to sent inside a database transaction. The PO lock serializes the claim with line edits; a vendor lock freezes recipient details while a SQL aggregate captures every ordered line. The saved snapshot and delivery key are returned only to the winner. Concurrent or subsequent requests receive no authorization and do not call the email sender. The sender passes the saved key in the provider's `Idempotency-Key` header, following [Resend's documented API](https://resend.com/docs/dashboard/emails/idempotency-keys). The action stores delivery completion or a bounded error. A failed or interrupted delivery keeps the RFQ frozen and visible for administrative verification; this round deliberately adds no automatic retry. Resend retains idempotency keys for 24 hours, so recovery must verify the original outcome before any further delivery attempt.

Vendor/PO bills and Finance costs both format `paid_at` through `todayISO(new Date(paid_at))`. A payment at `2026-10-23T18:00:00Z` now displays `Paid 2026-10-24` on both rendered surfaces.

Per coordinator direction, merge commit `fd8e703` brings `odoo-parity` into this worker branch. Its purchasing queries already use the shared `readAllOrThrow` helper from `lib/supabase/read-all.ts`; the deleted purchasing pager stays deleted. No separate paging loop was added.

Fail-first commit `5954873` recorded the action/provider/date regressions before the fix. The decisive results were:

```text
Before
expected "vi.fn()" to be called 1 times, but got 2 times
expected rendered payment text to contain Paid 2026-10-24; received Paid 2026-10-23
Test Files  3 failed (3)
Tests  7 failed | 4 passed (11)

After, the same focused files
Test Files  3 passed (3)
Tests  11 passed (11)

Final source gates
pnpm lint: $ eslint; exit 0
pnpm typecheck: $ tsc --noEmit; exit 0
pnpm test: Test Files 111 passed (111); Tests 774 passed (774); Duration 7.71s; exit 0
pnpm build: Compiled successfully in 8.6s; Finished TypeScript in 7.7s
Generating static pages using 17 workers (22/22) in 215ms
ƒ Proxy (Middleware)
ƒ (Dynamic) server-rendered on demand
exit 0
```

The new SQL assertions have not run in this worker. The coordinator must apply the new migration and execute both purchasing SQL files on integration, including the cascade regression that fails against the original guard. Browser and real email delivery were not run here; the concurrency and date regressions execute the real server action and rendered components with mocked I/O. No Supabase or Docker service was started.
