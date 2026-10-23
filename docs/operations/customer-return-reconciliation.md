# Customer-return valuation upgrade preflight

Run this before applying `20261025130500_procure_stock_fixes.sql`, and again before the W5 inventory upgrade. That earlier migration rejects historical customer returns whose rounded inventory addition differs from their cumulative share of the original delivery value. A later migration cannot supply its report after that rejection.

Use an authorized database connection that can read all organizations. An ordinary member connection sees only its RLS scope. Take a database backup and preserve the report outside the database before changing anything. Do not put credentials in command history or in this repository; use the approved connection service or environment.

```sh
psql -X -q -v ON_ERROR_STOP=1 --csv -f supabase/preflight/customer_return_valuation_report.sql > customer-return-valuation.csv
psql -X -v ON_ERROR_STOP=1 -f supabase/preflight/customer_return_valuation_check.sql
```

The report creates a session-local view and reads retained ledger snapshots. It does not require `stock_value_satang`, so it runs on the schema before the retained-value migration as well as afterward. It reports the organization, return and original delivery IDs, balance, posting sequence, original delivered value, cumulative returned quantity, actual addition, expected addition, difference and reason. An empty report means this particular preflight found no incompatible historical returns. It does not certify all inventory or financial data.

The check exits nonzero when the report contains a finding. Do not catch that error and continue migration. Missing or mismatched source deliveries and excess cumulative returns also require review, even when an amount happens to match.

For findings, pause the upgrade and have the inventory owner and accounting owner reconcile the original receipt/delivery/return evidence, quantities, retained snapshots and COGS periods. Record the approved target values and downstream financial impact for each affected balance and posting sequence. A normal appended stock adjustment cannot repair an earlier return's own snapshot comparison.

Prepare a separately reviewed, organization-scoped reconciliation or ledger replay migration from that approved mapping. Test it on a restored copy first. The migration must preserve source references, audit the approved corrections, rebuild affected running balances and retained stock values consistently, and demonstrate the resulting monthly COGS. Do not disable append-only protection or edit retained amounts ad hoc in production. No automatic reconciliation is included in W5.

Rerun both scripts on the restored copy, apply the pending migrations, and run the full SQL suite plus inventory browser checks. Compare total quantities, stock values and COGS with the approved mapping. Obtain deployment authorization through the project's release process, retain the backup and reports, then repeat the same checks after the approved production upgrade.
