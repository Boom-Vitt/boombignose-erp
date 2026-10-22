# Portable self-hosting acceptance backlog

The ERP must be cloneable and usable by other people. This is an explicit acceptance criterion, not satisfied by the current Mac lane tests.

Current prerequisites: Node.js22+ (locked Supabase SDK requires>=22), pnpm with frozen lockfile, Docker and the installed compatible Supabase CLI for the retained Next test stack. The lighter candidate will need pinned Bun/Postgres versions after its spike. No new runtime/tool download was performed for this handover. `.env.example` now has placeholders for required keys, blank optional server secrets and no demo password; isolated runtime values are always private.

Release/install gates:

- Document clean-clone install, version checks, env generation, first owner/workspace creation, migrations, start/stop, upgrade and rollback on a supported fresh Linux/cloud environment and a clean developer machine. Test from the transferred base+bundle without pre-existing caches, owner accounts or credentials; fail clearly on missing prerequisites.
- Default bootstrap must create no embedded owner, fixture account or branded business. Existing `supabase/seed.sql` still creates known synthetic owner/member accounts and sample records; it is local-test-only and remains a release blocker. Split schema/bootstrap from an explicit opt-in synthetic demo seed; update legacy smoke fixtures to unique synthetic users before removing the demo assumption. Do not carry known local demo logins into production.
- Core install and its tests must work without AI/email/n8n/accounting providers. Optional adapters require explicit configuration and bounded timeouts. No guessed sender, webhook secret or owner organization may become the installation default. Document provider licensing/limits only after evidence.
- Document encrypted secret handling and least-privilege runtime/migration roles. No real keys, credentials or customer data in repo, image, seed or transfer.
- Provide backup/restore of database, principal mappings and any future attachments/document storage; include schema version, recovery-point/time objectives chosen by the operator, a synthetic restore drill and transaction/idempotency validation after restore. No backup/restore drill has yet run in this checkpoint.
- Prove upgrade preflight on legacy amounts, cross-org links, stored paid flags and unverified receipts; NOT VALID amount constraints must be checked/validated after authorized reconciliation. Existing bad data must stop the upgrade, not be silently reassigned/deleted/certified.
- Keep all application install/financial/access checks in appropriate application CI. The existing GitHub Pages job deploys only a static showcase and is not ERP application validation. Do not trigger publication for this transfer.

## License inspection, unchanged

**Correction — 2026-10-22:** The owner selected Community AGPL-3.0-only OR
Commercial after Pro application implementations were separated into `ee/`.
`LICENSE` and `COMMERCIAL-LICENSE.md` now govern Community; `ee/LICENSE` and
`bignose/LICENSE` remain separate commercial/proprietary scopes. The earlier
licensing observation below is historical and is superseded. This checkout
still builds a combined application; Community-only packaging remains a
separate task. See `docs/OPEN_CORE_BOUNDARY.md`.

`LICENSE.md` states NOT YET FINALIZED, proprietary/all rights reserved, internal use only, do not redistribute. It describes a proposed AGPLv3 OR Commercial direction but does not grant that license. README points to the same planned open-core direction. Licensing terms were not changed. Public redistribution and third-party self-hosting permission require a separate explicit licensing decision; technical portability work does not resolve this mismatch.
