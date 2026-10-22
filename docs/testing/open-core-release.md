# Open-core preparation verification — 2026-10-22

Scope: current worktree branch `Boom-Vitt/erp-open-core`. Pro isolation was
committed before Community relicensing as `4633aef` (English commit message).
No push, merge to the base branch, deployment, or database migration was run.

Runtime actually used: Node.js v24.20.0, pnpm 12.3.4; locked Next.js 16.2.9,
TypeScript 5.9.3, ESLint 9.39.4, Vitest 4.1.9. No dependencies were changed.

| Check | Observed result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0; 672 packages reused from cache, none downloaded |
| `pnpm install --frozen-lockfile --offline` (final) | Exit 0; lockfile current, no changes |
| `pnpm exec tsc --noEmit` (final) | Exit 0, no diagnostics |
| `pnpm lint` (final) | Exit 0, no errors or warnings |
| `pnpm test` (final) | 66 test files, 500 tests passed; 0 failures |
| `pnpm build` (final) | Exit 0; optimized build and TypeScript succeeded, 20/20 static pages generated, all existing routes compiled |
| `python3 .project-memory/read.py --check` | 9 files checked; no problems |
| `git diff --check -- . ':!LICENSE'` | Clean; canonical AGPL checked byte-for-byte separately |

Vitest's existing Vite plugin deprecation advisory remains non-failing; its
configuration/dependencies were otherwise preserved. The source's initial
suite already had 496 tests; 125 in the old README was stale. Four added tests
cover org/entity/invoice filtering for accounting queries and access/scoping
of portal bearer-token reads. Pro feature tests moved with their implementations
and remain included through `ee/**/*.test.ts`.

The GitHub license body ends with a blank line; it is retained to preserve the
requested unmodified text rather than applying a whitespace cleanup to LICENSE.

Additional assertion-based checks passed:

- `LICENSE` equals the unmodified `gh api licenses/agpl-3.0 --jq .body` output.
- ERP manifest uses `AGPL-3.0-only OR LicenseRef-BoomBigNose-Commercial`;
  all three BigNose manifests use `UNLICENSED`.
- The four Pro Next page entry points contain only a re-export plus static
  `dynamic = "force-dynamic"` configuration.
- README's complete BBN header and footer blocks equal their pre-task bytes.
- The bundled `reverse-engineer-anything/LICENSE` equals its pre-task bytes
  and is the only bundled third-party license file found outside dependencies.
- No new address literal was added to the license, contribution, PR-template,
  README, metadata, or notice files.

Not exercised: live Supabase/API integration, browser E2E, the independent
BigNose workspace suite, and legal review. Shared historical SQL/types are
unchanged, and no standalone Community-only packaging was added. The precise
feature interpretation and production licensing scope are documented in
[OPEN_CORE_BOUNDARY.md](../OPEN_CORE_BOUNDARY.md).
