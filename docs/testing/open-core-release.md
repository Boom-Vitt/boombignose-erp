# Open-core preparation verification

Verified on 2026-10-22 in worktree branch `Boom-Vitt/erp-open-core`.
The two preparation commits were rewritten only to remove root-local assistant
bookkeeping. Pro separation still precedes Community relicensing. The inherited
base commit `a7b3e97` and `bignose/INSTRUCTIONS.md` are unchanged. No push,
base-branch merge, deployment, or existing database migration was performed.

Runtime used: Node.js v24.20.0 and pnpm 12.3.4. Locked versions remain Next.js
16.2.9, TypeScript 5.9.3, ESLint 9.39.4, and Vitest 4.1.9. No dependency or
lockfile change was required.

| Check | Final result |
| --- | --- |
| `pnpm install --frozen-lockfile` | Exit 0, lockfile current |
| `pnpm install --frozen-lockfile --offline` | Exit 0, no downloads |
| `pnpm exec tsc --noEmit` | Exit 0, no diagnostics |
| `pnpm exec tsc --noEmit -p tsconfig.pro.json` | Exit 0, no diagnostics |
| `pnpm lint` | Exit 0, no diagnostics |
| `pnpm test` | 70 files and 510 tests passed, zero failures |
| `pnpm build` | Exit 0, optimized Community build and all routes compiled |
| `BBN_EDITION=pro pnpm build` | Exit 0, optimized Pro build and all routes compiled |
| `node scripts/verify-community.mjs` | Exit 0, all five checks pass in a copied checkout with `ee/` physically absent |
| `node scripts/test-community-workspace.mjs` | 17 isolated PostgreSQL checks pass with Pro sources, 14 pass without `ee/` |
| `git diff --check` | Clean for the correction |

The no-Pro checkout passed frozen offline install, TypeScript, ESLint, 486 tests
in 61 files, and its production build. Both production builds generated 20 of
20 static pages. The copy excludes ignored files and Pro sources, clones local
dependencies, and is removed after verification. It never moves or deletes the
working repository's `ee/` directory.

The database checks run the actual new SQL against a disposable `postgres:17`
container with a minimal contract fixture, a temporary in-memory data directory,
and no external network. They cover anonymous rejection, input validation,
same-key replay, changed-input conflict, cross-key and cross-user races,
rollback, revoked-membership replay, and separate hosted provisioning. The
container is removed afterward. These checks do not certify the complete
Supabase schema or browser signup flow.

One interim test run needed a `server-only` mock for the new Pro adapter test.
An existing subprocess test also exceeded its five-second timeout during
concurrent compiler runs. The final unmodified-timeout full suite passed.
Repeated SQL checks exposed an initdb startup race in the test driver. It now
waits through TCP on container loopback, which excludes PostgreSQL's temporary
initialization socket. Final checks passed after that correction.

The new tests also cover Community-only rendering and unavailable Pro routes,
default/Pro/invalid edition selection, guarded first-org errors, and Pro
onboarding dispatch to the hosted action. The initial source already had 496
tests; the old README's 125-test count was stale. Vitest's preexisting plugin
deprecation advisory remains non-failing.

Additional checked invariants:

- `LICENSE` matches the unmodified GitHub license API body. Its canonical
  trailing blank line is preserved and verified separately from whitespace checks.
- Both rewritten preparation commits omit `.project-memory/`, `AGENTS.md`,
  `INSTRUCTIONS.md`, and `agent.md` at the repository root.
- A dependency walk from Community signup, onboarding, invitation, settings,
  and layout entry points reaches 49 local files and no `ee/` file.
- README's complete BBN header/footer blocks match their pre-task bytes.
- The bundled MIT license is unchanged. BigNose remains separately proprietary.

Independent read-only re-review approved the correction after fixing Pro
onboarding's selected action. Final scope and the complete Pro file list are
in [OPEN_CORE_BOUNDARY.md](../OPEN_CORE_BOUNDARY.md).

Not run: full live Supabase/API integration, browser E2E, the independent
BigNose suite, or legal review. New SQL was executed only in the disposable
contract-test containers.
