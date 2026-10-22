# Open-core implementation boundary

Inventory verified on 2026-10-22 against `docs/OPEN_CORE_STRATEGY.md` and source.

| Area | Implementation | Reason |
| --- | --- | --- |
| Client portal | `ee/portal/` | Pro table: tokenized client-facing access, quote acceptance, payment reports, and staff share-link management |
| Accounting | `ee/accounting/` | Pro table: FlowAccount/PEAK/Xero adapters, invoice payload mapping, connection settings, invoice push and sync-map reads/UI |
| Workspaces | `ee/workspaces/` | Pro table: real multi-org list/switcher, invitation management/acceptance, hosted workspace provisioning/onboarding, and retry/cookie helpers |
| BigNose OS | `bignose/` | Separate proprietary product, including its agent runtime, desktop application and bundled skills; see `bignose/LICENSE` |

`app/portal/[token]/page.tsx`, `app/(app)/settings/accounting/page.tsx`,
`app/invite/[token]/page.tsx`, and `app/onboarding/page.tsx` are thin Next.js
entry points. Their static `dynamic` settings remain at the route boundary.
Other Community pages import small Pro components/query seams where needed;
Pro implementation and feature tests live in `ee/`. Server-action directives,
role checks, org filters, token checks, and authenticated RPCs are preserved.

## Community code deliberately retained

- CRM, deals, projects, tasks, milestones, quotes, operational invoices, receipt
  verification, reports/exports, subscriptions and recurring draft generation.
- Dashboard, calendar, template library, blueprint/showcase, and warehouse view.
- Basic AI assists in `lib/ai/`: single-request deal summaries, follow-up drafts,
  and meeting intake. There is no ERP agent loop, tool-executing planner,
  automation-pack marketplace, or advanced agent pack in these modules.
- `lib/automation/`, cron routes and n8n webhooks: baseline reminders, recurring
  billing commands, durable outbox/retries, and inbound receipt deduplication.
  Reliability/security supporting basic workflows is Community infrastructure.
- `lib/mcp/`: tenant-scoped ERP data tools, not the BigNose agent runtime.
- Authentication/session context (`lib/auth.ts`), membership validation, the
  active-org cookie contract, sign-out/account recovery, and fixed
  owner/admin/member checks (`lib/permissions.ts`). A capability lookup over
  those three roles is basic RBAC; no custom roles, policy editor, or SSO exists.
- Shared Supabase clients, generated database types, schema, migrations, RLS,
  and atomic finance/workspace/claim RPC contracts. Historical migrations mix
  these contracts and security fixes across features; they are retained under
  Community terms without rewriting applied history. Pro modules own their
  application-level queries, mutations, and orchestration. A backing table or
  shared RPC does not grant a license to the Pro application implementation.

No separate SSO implementation, advanced RBAC, white-label implementation,
SLA service, or advanced ERP AI/automation pack was found. Future implementations
of those Pro features belong in `ee/` from the outset. Basic AI, recurring
billing/outbox, and shared database contracts are the interpretation points to
revisit if the product boundary changes; do not infer a license from a feature's
name alone.

## Packaging and license scope

This checkout contains both Community and commercially licensed Pro sources.
It builds the existing combined application; this change does not add an
edition selector or claim that deleting `ee/` alone produces a Community build.
A Community-only distribution must replace/remove the listed Pro imports and
routes. Production use of this checkout's Pro functionality requires a
commercial agreement under `ee/LICENSE`. BigNose stays outside the ERP build,
as declared by `tsconfig.json` and `eslint.config.mjs`; its pnpm workspace and
bundled third-party license remain in place.

See `NOTICE`, `COMMERCIAL-LICENSE.md`, `CLA.md`, and `TRADEMARK.md` for the
repository's licensing and contribution boundaries. License preparation does
not certify financial, tax, or customer-production readiness; the separate
acceptance gates in `docs/testing/erp-gates.md` still apply.
