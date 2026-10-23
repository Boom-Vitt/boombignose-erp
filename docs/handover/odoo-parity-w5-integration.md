# W5 local integration handover

2026-10-23. Integration writer worktree `/Users/boombignose/orca/workspaces/erp-orca101/odoo-w5-integrate`, branch `Boom-Vitt/odoo-w5-integrate`. Base and untouched local `main`: `6e7a870f0659114b47fc367f13a9373369f45349`. Coordinator owns final verification and any main fast-forward. Nothing was pushed, deployed, or merged into main.

Accepted code candidate `f26e335a21b1d9a32ba5f44ceb3d476c7416c21b` passes lint, typecheck, 161 unit files / 1,283 tests, production build, 59 SQL files / 1,507 assertions, and seven finance concurrency assertions. The full production browser suite passes 63 tests with 0 failures and 4 expected Community skips. The final handover commit changes only this document.

## Isolation and runtime

Observed runtime: Node.js v24.20.0, pnpm 12.3.4, installed Supabase CLI 2.120.0. The app requires Node >=22. Dependencies and lockfile are unchanged.

The exact brief command `node scripts/worktree-env.mjs w5-integrate` exited 1 with `Use lane 1..6`. The existing script accepts only numeric lanes. Without changing tracked tooling, `node scripts/worktree-env.mjs 1` exited 0 after checking unused ports. Generated `.local-stack/isolation.json` and Supabase config agree on project `erp-58f5b594f6-1`, app `http://127.0.0.1:3101`, API `http://127.0.0.1:55101`, DB port `55102`. All database commands use `--workdir .local-stack`. Private `.env.local` was created from this project's status and is ignored. Credentials were neither printed nor committed. Main stack and every other lane were left alone.

`pnpm exec supabase start --workdir .local-stack -x studio,imgproxy,edge-runtime,logflare,vector,supavisor,realtime` exited 0. Only the lane's own stack was started. Logs are local `.audit/w5-integrate/start.log`, `isolation-requested.log`, and `isolation.log`. Playwright starts and stops the production app on port 3101 through checked-in configuration.

## Merge sequence and conflict resolutions

Each branch's handover was read before its merge. Each merge used `git merge --no-ff <branch>`. A, B, and fixed C passed all required gates before the next merge began.

### W5a

Branch `odoo-w5a-finance`, merge commit `8c231737fa780fdc9b5369ea6a60e2bcda4f11ec`.

No conflicted files.

### W5b

Branch `odoo-w5b-vendor-bills`, merge commit `d32a7b5712e17ef383aaf9e31cad1b03394d43c7`.

- `app/(app)/projects/[id]/page.tsx`: Retain credit-note base deductions and add recoverable input VAT, fetching VAT registration with existing error handling.
- `app/(app)/settings/finance/page.tsx`: Select both payment reviewer policy and bill tolerance; retain both forms.
- `lib/documents/vat-pages.test.ts`: Combine invoice allocation fixture with vendor VAT/reference fields.
- `lib/metrics/projects.ts`: Keep credited base as argument four and add VAT registration as argument five; update all affected test callers and add combined financial regression.
- `lib/queries/dashboard.test.ts`: Keep credit/allocation/date evidence and add cost input VAT fields.
- `lib/types/database.ts`: Retain both review policy and tolerance fields in Row/Insert/Update; retain all additive finance and vendor contracts. Regenerate isolated schema to audit and compare both parents; preserve existing narrowed writable types rather than replace entire file.

### W5c

Branch `odoo-w5c-line-grid`, merge commit `771706d56b325d694034f94f1919ee457a5ba8b6`.

- `app/(app)/finance/invoices/[id]/pdf/route.ts`: Keep allocation-aware invoice_receipts and add documentSections so corrections and section/note layout both survive.
- `app/(app)/purchases/[id]/page.tsx`: Keep vendor matches/tolerance and BillForm, replace removed per-line controls with LineGrid and load authoritative grid rows.
- `app/(app)/purchases/actions.ts`: Retain BillInput/CreditInput for matching and remove obsolete LineInput with the removed per-item action.
- `lib/purchasing/seed-ids.test.ts`: Keep vendor credit tests and import; remove only the removed per-item action import.
- `lib/types/database.ts`: Keep finance credit tables and add document_sections/save_document_lines. Compare isolated generated schema against both parents; retain existing narrowed types.

### W5d

Branch `odoo-w5d-inventory`, merge commit `5567498a294c279ef6ed3606b344256f95fb3344`.

- `app/(app)/purchases/[id]/page.tsx`: Retain LineGrid, vendor BillForm/matches/credit UI; add tolerance-aware receipt capacity, optional date, approval/reopen commands, editable RFQ header and receipt documents link. Remove only obsolete per-line controls.
- `app/(app)/purchases/actions.ts`: Keep credit allocation and bill-tolerance actions and append approve/reopen/update RFQ actions, with each capability and validation preserved.
- `e2e/purchasing.spec.ts`: Keep shared-grid, PDF and matching checks; apply W5d product option selector scoped to Suggestions listbox.
- `lib/types/database.ts`: Combine all settings fields; keep W5b p_bill matching signature and credit RPC while adding W5d optional receive date and all stock contracts. Regenerated isolated schema checked against both parents.

## Gate evidence

All logs below are relative to this worktree and remain local under `.audit/w5-integrate/`. `gates.jsonl` records full expanded command arguments, tested SHA, exit code, elapsed time, and log path. SQL commands below use an absolute glob equivalent to the runner's sorted absolute `.sql` paths. Browser checks use the existing production `.next` build; no dev server or second build ran concurrently.

| Stage | Tested SHA | Command | Exit | Result | Log |
| --- | --- | --- | --- | --- | --- |
| a | `8c231737fa78` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/a-reset.log` |
| a | `8c231737fa78` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 40 files / 1213 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/a-sql.log` |
| a | `8c231737fa78` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/a-lint.log` |
| a | `8c231737fa78` | `pnpm typecheck` | 0 | PASS; 0 errors | `.audit/w5-integrate/a-typecheck.log` |
| a | `8c231737fa78` | `pnpm test` | 0 | 154 files / 1218 tests passed, 0 failed, 0 skipped | `.audit/w5-integrate/a-test.log` |
| a | `8c231737fa78` | `pnpm build` | 0 | PASS; no test-case count | `.audit/w5-integrate/a-build.log` |
| a | `8c231737fa78` | `node supabase/tests/payment-concurrency.test.mjs` | 0 | 7 assertions passed, 0 failed, 0 skipped | `.audit/w5-integrate/a-concurrency.log` |
| b-schema | `8c231737fa78` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/b-schema-reset.log` |
| b | `d32a7b5712e1` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/b-reset.log` |
| b | `d32a7b5712e1` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 44 files / 1341 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/b-sql.log` |
| b | `d32a7b5712e1` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/b-lint.log` |
| b | `d32a7b5712e1` | `pnpm typecheck` | 0 | PASS; 0 errors | `.audit/w5-integrate/b-typecheck.log` |
| b | `d32a7b5712e1` | `pnpm test` | 0 | 156 files / 1241 tests passed, 0 failed, 0 skipped | `.audit/w5-integrate/b-test.log` |
| b | `d32a7b5712e1` | `pnpm build` | 0 | PASS; no test-case count | `.audit/w5-integrate/b-build.log` |
| b | `d32a7b5712e1` | `node supabase/tests/payment-concurrency.test.mjs` | 0 | 7 assertions passed, 0 failed, 0 skipped | `.audit/w5-integrate/b-concurrency.log` |
| c-schema | `d32a7b5712e1` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/c-schema-reset.log` |
| c | `771706d56b32` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/c-reset.log` |
| c | `771706d56b32` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 45 files / 1388 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/c-sql.log` |
| c | `771706d56b32` | `pnpm lint` | 1 | FAIL; 3 local-helper import errors, 0 warnings | `.audit/w5-integrate/c-lint.log` |
| c-retry | `771706d56b32` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/c-retry-lint.log` |
| c-retry | `771706d56b32` | `pnpm typecheck` | 2 | FAIL; 2 TypeScript errors | `.audit/w5-integrate/c-retry-typecheck.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/c-fixed-reset.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 45 files / 1388 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/c-fixed-sql.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/c-fixed-lint.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm typecheck` | 0 | PASS; 0 errors | `.audit/w5-integrate/c-fixed-typecheck.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm test` | 0 | 156 files / 1265 tests passed, 0 failed, 0 skipped | `.audit/w5-integrate/c-fixed-test.log` |
| c-fixed | `f13d0bb7f44b` | `pnpm build` | 0 | PASS; no test-case count | `.audit/w5-integrate/c-fixed-build.log` |
| c-fixed | `f13d0bb7f44b` | `node supabase/tests/payment-concurrency.test.mjs` | 0 | 7 assertions passed, 0 failed, 0 skipped | `.audit/w5-integrate/c-fixed-concurrency.log` |
| d-schema | `f13d0bb7f44b` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-schema-reset.log` |
| d | `5567498a294c` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-reset.log` |
| d | `5567498a294c` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 1 | 59 files / 1507 assertions, 0 assertion failures, 0 skips; cleanup runtime failure | `.audit/w5-integrate/d-sql.log` |
| d-diagnostic | `5567498a294c` | `pnpm typecheck` | 2 | FAIL; 1 TypeScript errors | `.audit/w5-integrate/d-diagnostic-typecheck.log` |
| d-fixture-fixed | `5567498a294c` | `pnpm typecheck` | 0 | PASS; 0 errors | `.audit/w5-integrate/d-fixture-fixed-typecheck.log` |
| d-cleanup-green | `5567498a294c` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-cleanup-green-reset.log` |
| d-cleanup-green | `f26e335a21b1` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 1 | INVALID: 59 files / 11 assertions emitted; database reset overlapped this run. No accepted result. | `.audit/w5-integrate/d-cleanup-green-sql.log` |
| d-fixed | `f26e335a21b1` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-fixed-reset.log` |
| d-fixed | `f26e335a21b1` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 59 files / 1507 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/d-fixed-sql.log` |
| d-fixed | `f26e335a21b1` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/d-fixed-lint.log` |
| d-fixed | `f26e335a21b1` | `pnpm typecheck` | 0 | PASS; 0 errors | `.audit/w5-integrate/d-fixed-typecheck.log` |
| d-fixed | `f26e335a21b1` | `pnpm test` | 0 | 161 files / 1283 tests passed, 0 failed, 0 skipped | `.audit/w5-integrate/d-fixed-test.log` |
| d-fixed | `f26e335a21b1` | `pnpm build` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-fixed-build.log` |
| d-fixed | `f26e335a21b1` | `node supabase/tests/payment-concurrency.test.mjs` | 0 | 7 assertions passed, 0 failed, 0 skipped | `.audit/w5-integrate/d-fixed-concurrency.log` |
| d-final | `f26e335a21b1` | `pnpm exec supabase db reset --local --workdir .local-stack` | 0 | PASS; no test-case count | `.audit/w5-integrate/d-final-reset.log` |
| d-final | `f26e335a21b1` | `pnpm exec supabase test db --workdir .local-stack "$PWD"/supabase/tests/*.sql` | 0 | 59 files / 1507 assertions, 0 assertion failures, 0 skips; PASS | `.audit/w5-integrate/d-final-sql.log` |
| d-final | `f26e335a21b1` | `pnpm e2e` | 0 | 63 passed / 0 failed / 4 skipped | `.audit/w5-integrate/d-final-e2e.log` |
| d-final-lint | `f26e335a21b1` | `pnpm lint` | 0 | PASS; 0 errors, 0 warnings | `.audit/w5-integrate/d-final-lint-lint.log` |

Schema preparation stages `b-schema`, `c-schema`, and `d-schema` ran while their merge conflicts were resolved, before the merge commit. Their recorded SHA is the existing first parent. Acceptance evidence is the subsequent committed-candidate run. `d-fixture-fixed` typecheck was a diagnostic on uncommitted fixture changes, not acceptance evidence.

For B, C, and D, `pnpm exec supabase gen types typescript --local --workdir .local-stack` exited 0. Generated schemas are `b-generated-database.ts`, `c-generated-database.ts`, and `d-generated-database.ts` in the audit directory. TypeScript-AST comparisons against both parents confirm no parent table, view, or function was lost. Settings fields, credit quantities, vendor matching, document sections, optional receipt dates, and stock contracts match the migrated DB. Existing deliberately narrowed writable types were retained instead of replacing the whole file. The inherited Pro-only `provision_hosted_workspace` declaration is absent from Community SQL as expected. The inherited omitted `quote_conversion_requests.request_payload` Row field is unchanged and unused by app reads. Comparison logs are `{b,c,d}-types-comparison.log`.

## Failures and follow-up commits

- W5c first lint failed on three CommonJS imports in the ignored local schema-comparison helper. Converting that helper to ES imports fixed it without a product patch. Original failure evidence is `c-lint.log` and `c-lint-failed-local-helper.log`.
- W5c typecheck then found two stale `itemsRes` references in the auto-merged credit-note form. Two page regressions reproduced `ReferenceError: itemsRes is not defined`: 15 passed / 2 failed. Commit `f13d0bb7f44bd895a8bff295a4818ba885a2d39e` supplies only priced grid rows and retains the historical header-only fallback. Focused green: 17 passed / 0 failed. Evidence `c-credit-red.log`, `c-credit-green.log`; full gates reran as `c-fixed`.
- W5d SQL passed all 1,507 assertions but failed teardown when new `stock_documents` still referenced the W5b concurrency fixture PO. Typecheck independently reproduced the old missing-`p_bill` browser caller. Commit `f26e335a21b1d9a32ba5f44ceb3d476c7416c21b` deletes synthetic document lines/headers before that fixture PO, adapts matching evidence, and moves/extends the existing tolerance test into `e2e/purchasing.spec.ts`. No financial or stock production function was rewritten.
- One diagnostic SQL rerun, `d-cleanup-green`, overlapped the next reset. It is failed and discarded, never counted green. The own-lane gate runner now takes an exclusive local file lock, checked using a separate competing process. Final `d-final` reset and SQL replay run serially after the prior pipeline completed.
- Focused resolution checks exited 0: B 4 files / 30 tests, C 19 files / 207 tests, D 22 files / 131 tests. Logs are `{b,c,d}-resolution-focused.log`.

## Cross-track findings

W5a and W5c locking agrees. `20261026110000_line_grid.sql:55` mirrors the priced-line guard in `20261025100000_quotes_subscriptions.sql:294`. Both lock the invoice and reject sealed quote-source invoices, issued snapshots, verified direct payments, and pending direct claims. W5a seals converted deposit and final drafts in `20261026091500_mixed_deposits.sql:130`; its final credit function retains reservation checks in `20261026095000_credit_quantity_rounding.sql:33`. Multi-invoice claims and allocations require an issued snapshot, so the snapshot guard covers indirect receipt evidence. The client guard retains current-editor saves, the final dirty check, and field freezing through refresh. No policy conflict required a new SQL patch. Existing SQL tests cover issued section immutability, and existing browser tests cover save races. The stale credit form caller was fixed and regression-tested separately.

An independent read-only reviewer examined W5d `2601278` and `b8e4ff5`. It found no blocking issue in scheduled claims, opt-in authorization, vendor locking, tenant-qualified references, forced RLS, or transactional retries. It flagged one P3 limit in `b8e4ff5`: `receiptLimit` can advertise a cap above numeric(12,3)'s maximum. Ordered/received `999999999.999` with `0.01%` tolerance yields `1000099999.998`, while `serviceLineAmount` rejects that quantity. The purchase page can keep receipt entry visible at the storage limit. This was reproduced by executing the actual helpers from the commit. It is flagged and left unchanged as the brief requires.

W5b's return-credit capture remains additive to W5d's return command: quantity updates precede credit cost insertion, and matching/allocation functions remain owned by W5b. The combined purchasing browser scenario receives while confirmed, received, and billed; checks the exact 10% cap and invalid native input; bills receipts with different prices and VAT rates; returns all 11 units; allocates one credit across both original invoices; and checks zero net matched cost, VAT, stock quantity, and stock value. Existing purchasing rounding, payment presentation, grid, and PDF checks remain.

## Workflow and remaining limits

pstack poteto-mode, Ponytail full, Graphify, and scaled BBN sequencing were applied. Sequence Work into Verifiable Units kept each merge gated. Fix Root Causes adapted the shared-grid credit caller. Model the Domain reused priced GridRows, and Prove It Works required real migration, SQL, browser, and competing-session results. Graphify was updated in this worktree and query/explain traced invoice, project-profit, purchase, and receipt callers before source verification. The graph covers code AST relationships, not SQL semantics or document meaning. More than 5,000 nodes caused the CLI to generate an aggregated visualization. Graph outputs and assistant memory remain local.

Four Pro-only browser skips are expected for Community. No Pro acceptance, live email delivery, deployment, scheduler creation, or production migration is claimed. The maximum-quantity receipt UI issue above remains flagged. The coordinator still owns verification and main integration.

## Supplementary checks and independent review

| Command | Exit | Observed result | Log |
| --- | --- | --- | --- |
| `pnpm exec vitest run lib/metrics/projects.test.ts lib/metrics/time-metrics-regression.test.ts lib/documents/vat-pages.test.ts lib/queries/dashboard.test.ts` | 0 | 4 files / 30 passed, 0 failed, 0 skipped | `.audit/w5-integrate/b-resolution-focused.log` |
| `pnpm exec vitest run lib/purchasing/seed-ids.test.ts lib/documents/vat-pages.test.ts lib/line-grid lib/record` | 0 | 19 files / 207 passed, 0 failed, 0 skipped | `.audit/w5-integrate/c-resolution-focused.log` |
| `pnpm exec vitest run lib/documents/vat-pages.test.ts` before fix | 1 | 15 passed / 2 failed, 0 skipped | `.audit/w5-integrate/c-credit-red.log` |
| `pnpm exec vitest run lib/documents/vat-pages.test.ts` after fix | 0 | 17 passed / 0 failed, 0 skipped | `.audit/w5-integrate/c-credit-green.log` |
| `pnpm exec vitest run lib/purchasing lib/inventory lib/documents/vat-pages.test.ts` | 0 | 22 files / 131 passed, 0 failed, 0 skipped | `.audit/w5-integrate/d-resolution-focused.log` |
| `git diff --check` | 0 | No whitespace errors | Final local check |
| `python3 .project-memory/read.py --check` | 0 | Nine local context files checked, no problems | Final local check |
| `git diff --exit-code 6e7a870 HEAD -- package.json pnpm-lock.yaml` | 0 | Dependency manifest and lockfile unchanged | Final local check |

A fresh independent read-only reviewer approved source candidate `f26e335a21b1d9a32ba5f44ceb3d476c7416c21b` after inspecting the three conflicted merge diffs, both follow-up commits, current source, and Graphify relationships. It found no new blocking issue. Scoped comment review found zero added comments or suppressions and required no changes. The reviewer did not execute database or browser gates; the owner ran the checks above. Local review evidence is `.audit/w5-integrate/final-source-review.md`, `guard-review.md`, and `inventory-review.md`.

Attention: review used separate Codex agents with the inherited runtime model. A different model-family review is not claimed. The known P3 maximum-quantity receipt UI limit remains as required by the brief. Logs, Graphify output, memory, environment files, and the isolated stack are retained locally for the coordinator. No recurring background work was created.
