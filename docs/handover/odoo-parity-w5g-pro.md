# Pro edition handover: the full suite passes with Pro enabled

Branch `odoo-w5g-pro`, from `odoo-parity` at `e5022f1`. Commits are local and nothing was pushed.

## What was done

I built the Pro edition, installed the Pro database objects on this track's isolated stack (API 56201, app 3111) and ran the full `pnpm e2e` suite with Pro enabled. The suite ran the 4 specs that skip in Community and the Pro branch of `vat-wht.spec.ts` (the portal tax invoice).

No test failed in any Pro run, so no product code changed. This branch adds only this handover.

## How to run Pro locally

Pro differs from Community in two places. The build selects `ee/` modules, and the database needs the SQL in `ee/supabase/`, which is not a migration.

1. Set `BBN_EDITION=pro` in `.env.local`. `next.config.ts` and `e2e/edition.ts` both read it through Next's env loading, and the shell value wins if set.
2. Reset the database, then install every file in `ee/supabase/` as the `postgres` role. Every `supabase db reset` drops these objects, so repeat this step after each reset. `psql` is not installed on this machine, so run it inside the database container:

   ```sh
   for f in ee/supabase/*.sql; do
     docker exec -i supabase_db_<project_id> psql -X -q -U postgres -v ON_ERROR_STOP=1 < "$f"
   done
   ```

   On the wave-5 stacks, `.local-stack/db-reset.sh` now does this whenever `.env.local` contains `BBN_EDITION=pro`. It runs after the reset and before the pgTAP suite, and prints `pro sql applied: provision-hosted-workspace.sql`. The script is git-ignored, so here is the added block (container `supabase_db_odoo-w4g-db` on this stack):

   ```sh
   if grep -qx 'BBN_EDITION=pro' "$SRC/.env.local" 2>/dev/null; then
     for f in "$SRC"/ee/supabase/*.sql; do docker exec -i supabase_db_odoo-w4g-db psql -X -q -U postgres -v ON_ERROR_STOP=1 < "$f"; done
     echo "pro sql applied: $(ls "$SRC"/ee/supabase/*.sql | xargs -n1 basename | tr '\n' ' ')"
   fi
   ```

3. Run `pnpm build`. The edition is fixed at build time. Rebuild after any edition change, because changing only the environment of a built server does not change its modules.
4. Run `pnpm e2e`. Expect 53 passed and 0 skipped. Community gives 49 passed and 4 skipped.

To check which edition a build holds, list the `ee/` sources in its server source maps. A Pro build lists 35, covering `ee/edition.tsx`, `ee/accounting/`, `ee/portal/` and `ee/workspaces/`. A Community build lists 0. Searching the build for `provision_hosted_workspace` proves nothing, because the shared generated types in `lib/types/database.ts` contain that name in both editions.

To check the database, `select proname from pg_proc where proname = 'provision_hosted_workspace'` returns one row after step 2 and none after a Community reset.

To go back to Community, set `BBN_EDITION=community`, reset (the script skips the Pro SQL), and rebuild.

## Files

- `docs/handover/odoo-parity-w5g-pro.md` is new.
- Git-ignored and not committed: `.env.local` now sets `BBN_EDITION=pro`, and `.local-stack/db-reset.sh` gained the block above. This worktree is left on a Pro build with the Pro SQL installed.

## SQL function ownership

Created: none. Replaced: none. The reset flow installs `public.provision_hosted_workspace(text, uuid)` from the unchanged `ee/supabase/provision-hosted-workspace.sql`.

## How it was verified

Every run used this track's stack only, on Node v24.20.0 and pnpm 12.3.4. Each Pro run started from `.local-stack/db-reset.sh`, which installed the Pro SQL and then passed the full pgTAP suite (`Files=33, Tests=1047, Result: PASS`).

```
pro run 1 (build 1):  53 passed (1.5m)   exit 0
pro run 2 (build 1):  53 passed (1.2m)   exit 0
pro run 3 (build 1):  53 passed (1.3m)   exit 0
community (rebuilt):  4 skipped  49 passed (1.0m)   exit 0
pro run 4 (rebuilt):  53 passed (1.4m)   exit 0
```

In every Pro run these 4 tests ran and passed instead of skipping:

```
✓ e2e/payment-verification.spec.ts:12:5 › customer report stays pending until owner verifies actual receipt
✓ e2e/tenant-onboarding.spec.ts:248:1 › switching two actual memberships fences dashboard, clients, deals and exports
✓ e2e/tenant-onboarding.spec.ts:297:1 › a zero-membership account reaches onboarding and provisions one owner workspace
✓ e2e/v2-batch2.spec.ts:21:5 › accounting: connect a provider then sync an invoice records a synced map row
```

The Community reset left no `provision_hosted_workspace` in the database, and the Community build held no `ee/` source.

Other gates, all exit 0:

```
$ pnpm lint                                        # eslint, no diagnostics
$ pnpm typecheck                                   # tsc --noEmit
$ pnpm exec tsc --noEmit -p tsconfig.pro.json      # Pro typecheck
$ pnpm test
 Test Files  150 passed (150)
      Tests  1192 passed (1192)
$ node scripts/test-community-workspace.mjs
PASS 17 PostgreSQL checks. Community singleton bootstrap, authentication, concurrency, retries, rollback and optional Pro provisioning.
$ pnpm build                                       # Pro, then Community, then Pro again
```

## Open issues

- `pnpm local:up` and `pnpm local:migrate` (`lib/local/stack.mjs`) run only `supabase migration up`. They never install `ee/supabase/*.sql`, so a Pro developer on that path gets a database without `provision_hosted_workspace`. Reading `ee/workspaces/actions.ts`, Pro onboarding would then show the RPC's missing-function error instead of creating the workspace. I did not run that case. `docs/OPEN_CORE_BOUNDARY.md` documents the manual `psql` step for deployments. I left the shared tooling alone because the boundary keeps Pro SQL out of the Community install path. A Pro-aware step in `stack.mjs` is the fix if the team wants one command.
- Pro e2e covers the portal payment report, the portal tax invoice, the workspace switcher, hosted provisioning and the accounting connect and sync flow. No browser test drives portal quote acceptance or the staff share-link controls. Quote acceptance is covered below the browser, by `lib/workflows/quote-parity-actions.test.ts` (the `portalAcceptQuote` action) and `supabase/tests/quotes_subscriptions.sql` (`accept_portal_quote`). The share-link actions in `ee/portal/manage-actions.ts` (enable, disable, regenerate token) have no direct test that I found. Both gaps predate this track.
