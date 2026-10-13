# ERP phased implementation registry

Base: `1940f95fa3c1bb951cc2fd44d90634e883e14b90`, current GitHub main verified 2026-10-13. Fresh task-local clone; unrelated checkouts and Orca untouched. Inputs read: Thai_SME_ERP_Blueprint.docx and parallel-worktree-plan.md (Library version 0).

The user-approved handoff defines phase numbering: Phase 1 services pilot and trust; Phase 2 transactions, recovery, recurrence and corrections; Phase 3 optional authorized campus projections. This supersedes the blueprint's different phase numbering. Full trading, manufacturing, payroll and statutory filing remain out of scope.

| Task | Owner / branch | Dependency | Changed paths | Acceptance evidence / status |
| --- | --- | --- | --- | --- |
| Pilot payment/security | Coordinator / erp/payment-security-pilot | Baseline + isolated runtime | SQL/types, payments, portal, finance, tests, contracts, isolation | Local gate PASS; independent exact-commit review pending |
| ERP-01 tenant DB | Coordinator / reserved erp/01-tenant-db | Pilot | All migrations, generated types, permissions, contracts | Queued |
| ERP-02 active org/onboarding | Reserved worker / erp/02-org-onboarding | Pilot + DB contracts | auth, onboarding, CRM queries | Queued |
| ERP-03 services | Reserved worker / erp/03-service-workflow | Pilot + DB contracts | quotes/projects/workflows | Queued |
| ERP-04 incoming payments | Coordinator during pilot / erp/04-verified-payments | Pilot | portal/finance/payment metrics | Pilot first |
| ERP-05 automation | Reserved worker / erp/05-reliable-automation | Pilot + DB contracts | automation/billing/webhooks | Queued |
| ERP-06 independent quality | Reserved reviewer / erp/06-quality-gates | Exact candidate commits | e2e/config/CI/evidence | Queued |
| Phase 3 campus | Reserved after transactions | Authorized common projections | warehouse UI/provider/accessibility | Queued |

Baseline: `pnpm lint` PASS; `pnpm typecheck` PASS; `pnpm test` 26 files / 232 tests PASS. First build blocked by font network access; network-enabled retry pending. E2E and DB baseline pending. Dependencies installed with frozen lockfile and lifecycle scripts disabled. No AGENTS.md or .agents/skills exists in this repository; relevant .claude agent guidance read.

Isolation: one writer on this pilot branch; .local-stack has project erp-21babc70c0-1; app 3101, API 55101, DB 55102, shadow 55100, other service ports unique. Runtime config/data, .env.local, .next and artifacts are worktree-local. No linked remote Supabase project.

Release gate: software tests do not establish real SME readiness. Actual pilot workflows, opening balance reconciliation, redacted deposit/milestone/partial-payment/correction/withholding examples, accountant review of Thai documents/exports, backup restore drill and user task completion must be evidenced before customer release. No pilot contact, real data import, deployment, production migrations, GitHub publication or main merge is authorized.

Pilot evidence (2026-10-13): lint PASS, typecheck PASS, unit 28 files/236 tests PASS; direct Supabase API 6/6 PASS (old schema 0/6); rollback pgTAP 6/6 PASS; fresh reset/seed PASS; production build PASS; isolated production-browser payment scenario + smoke 4/4 PASS. The CLI DB runner required an explicit test-file path because its default symlink-directory discovery stalled. Cached Chromium 1243 used because lockfile Playwright's expected 1228 is absent; no new browser installed. Legacy full E2E has not yet passed after changes: first full discovery run failed all 18 due missing browser, not product assertions. Original shared-demo tests run serially; new security/payment tests have unique per-run fixtures. Generated local types are normalized by trimming trailing whitespace.

Ruling: Run browser verification against a production build, not the dev server — Next dev did not become ready in 120s, while the production server did. Stale .next/dev generated types were removed before typecheck; runtime state remains worktree-local. Ruling: Seeded old paid/partial invoices now start sent with legacy_unverified synthetic receipts — they cannot bypass verified-settlement invariants. Real legacy data remains unchanged and must be reconciled before release.
