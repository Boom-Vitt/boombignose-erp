# ERP MCP Server (`lib/mcp/erp-server.mjs`)

Read-only Model Context Protocol (MCP) server for BoomBigNose Company OS, consumed over `stdio` by BigNose's desktop AI panel client (`bignose/core/src/mcp/client.ts`).

## BigNose Connector Configuration

BigNose connects to the ERP MCP server using a `stdio` connector with an absolute Node binary path and the repository path to `lib/mcp/erp-server.mjs`:

```json
{
  "transport": "stdio",
  "command": "/opt/homebrew/bin/node",
  "args": ["/Users/boombignose/Desktop/erp/boombignose-erp/lib/mcp/erp-server.mjs"],
  "enabled": true
}
```

Or symbolically:

```json
{
  "transport": "stdio",
  "command": "<absolute node>",
  "args": ["<repo>/lib/mcp/erp-server.mjs"],
  "enabled": true
}
```

Optional environment variables:

- `ERP_DIR`: Path to the ERP repository root (defaults to the repository root containing `lib/mcp/erp-server.mjs`).
- `ERP_ORG_ID`: Default workspace (`organizations.id`) UUID when multiple workspaces exist.

## Protocol & Process Lifecycle

- **Framing**: Hand-written JSON-RPC 2.0 over `stdio`, one newline-delimited JSON object per line on `stdout`. All diagnostic logs go exclusively to `stderr`.
- **Supported methods**: `initialize` (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`), `notifications/initialized`, `ping`, `tools/list`, and `tools/call`.
- **EOF handling**: Exits cleanly (`0`) when `stdin` reaches EOF.
- **Lazy local Supabase startup**: `tools/list` requires no database connection. On the first `tools/call`, the server verifies that `<ERP_DIR>/supabase/config.toml` declares `project_id = "boombignose-erp"`, then runs `<ERP_DIR>/node_modules/.bin/supabase status -o env --workdir <ERP_DIR>` and parses `stdout` only (`API_URL` and `SERVICE_ROLE_KEY`). Non-local `API_URL` hosts are refused.

## Tools & Arguments

All list tools accept `limit` (`1..100`, default `50`) and `offset` (`>= 0`, default `0`) and return `{ items, total, limit, offset, has_more }`. All money fields are returned as integer satang (`*_satang`) alongside a formatted Thai Baht string (`*_thb`, e.g. `"฿25,000.00"`).

| Tool | Arguments | Description |
| --- | --- | --- |
| `list_workspaces` | `limit?`, `offset?` | Lists ERP organizations (`id`, `name`, `slug`, `created_at`, `updated_at`). |
| `list_clients` | `org_id?`, `limit?`, `offset?` | Lists clients in the workspace (`id`, `org_id`, `name`, `industry`, `source`, `created_at`, `updated_at`). |
| `list_deals` | `org_id?`, `stage?`, `client_id?`, `limit?`, `offset?` | Lists CRM deals with stage, `value_satang`, `value_thb`, currency, and target dates. |
| `list_quotes` | `org_id?`, `status?`, `client_id?`, `limit?`, `offset?` | Lists quotations with `subtotal_satang`/`subtotal_thb`, `discount_satang`/`discount_thb`, and `total_satang`/`total_thb`. |
| `list_projects` | `org_id?`, `status?`, `client_id?`, `limit?`, `offset?` | Lists delivery projects with status, deadline, and `budget_satang`/`budget_thb`. |
| `list_invoices` | `org_id?`, `status?`, `client_id?`, `limit?`, `offset?` | Lists invoices as the finance page shows them, newest first. `status` is the effective status (draft/cancelled as stored; `paid` when verified payments cover the amount; `overdue` when past due in Asia/Bangkok; `partially_paid`; else `sent`) and is what the `status` filter matches; `stored_status` is the raw column. Also number, dates, `amount_satang`/`amount_thb`, `discount_satang`/`discount_thb`, `paid_satang`/`paid_thb` (verified payments only) and `outstanding_satang`/`outstanding_thb`. |
| `list_payment_claims` | `org_id?`, `status?`, `client_id?`, `invoice_id?`, `limit?`, `offset?` | Lists customer/staff payment claims with status, source, and `amount_satang`/`amount_thb`. |
| `finance_summary` | `org_id?` | Returns workspace financial totals (cash balance, monthly burn, invoiced total, verified paid, unpaid balance, costs, subscription MRR, open quotes, pipeline, and pending payment claims) in satang and THB. Mirrors the dashboard: monthly burn is the org setting, else this month's costs (Asia/Bangkok); unpaid counts every non-draft, non-cancelled invoice with a balance after verified payments only, even if its stored status is `paid`. Errors rather than return a total from a partial read. |

## Workspace Scoping (`org_id`)

Because the local Supabase service-role key bypasses Row Level Security (RLS), the MCP server enforces tenant scoping in code:

1. Every data tool (`list_clients`, `list_deals`, `list_quotes`, `list_projects`, `list_invoices`, `list_payment_claims`, `finance_summary`) requires a valid `org_id`.
2. `org_id` may be omitted only when `ERP_ORG_ID` is set or when the database contains a single organization.
3. The resolved `org_id` is verified against `organizations`; unknown organization IDs return a tool error (`isError: true`).
4. Every tenant table query applies `.eq("org_id", orgId)` with an explicit column whitelist.

## Read-Only & PDPA Privacy Rules

The BigNose desktop AI panel forwards MCP tool results to a cloud language model. To comply with Thailand's Personal Data Protection Act (PDPA) and minimize data exposure:

- **Read-only**: The server executes `select` queries only. It never calls `.insert()`, `.update()`, `.upsert()`, `.delete()`, or `.rpc()`.
- **Explicit column whitelists (never `*`)**:
  - **Excluded personal contact details**: `contacts` (`email`, `phone`) and user/profile emails (`profiles`, `actor_email`, user UUIDs such as `owner`, `reviewed_by`, `verified_by`, `submitted_by`) are never queried or returned.
  - **Excluded free-text & address/tax fields**: `notes`, `body`, `reusable_notes`, `billing_address`, `business_address`, and `tax_id` are never returned.
  - **Excluded payment evidence & bank details**: `reference`, `review_reference`, `verification_reference`, `idempotency_key`, and `command_key` are never returned.
  - **Excluded secrets & tokens**: `portal_token`, `SERVICE_ROLE_KEY`, and process environment variables are never returned, logged, or echoed in error messages.
- **Natural-person client names notice**: Client records (`clients.name`) can be natural persons (such as sole proprietors or individual freelancers) and those names reach the cloud model through `list_clients`. Workspace operators should ensure appropriate notice/basis when naming natural-person sole proprietors in `clients.name`.
