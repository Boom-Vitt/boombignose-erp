# ERP checkpoint QA gates

## Runtime compatibility

The locked `@supabase/supabase-js` 2.110.0 package declares `engines.node: >=22.0.0`. This repository's application engine therefore requires Node.js 22 or later. Supabase's [official deprecation notice](https://supabase.com/changelog/45715-deprecation-notice-dropping-support-for-node-js-20) ended JavaScript SDK support for Node.js 20 on 30 June 2026 and directs SDK consumers to Node.js 22 or later. This requirement concerns the JavaScript application and SDK, not a claim about the Supabase server's runtime.

Record both the installed package requirement and the actual executing runtime:

```sh
node --version
node -p "require('@supabase/supabase-js/package.json').version"
node -p "require('@supabase/supabase-js/package.json').engines.node"
pnpm --version
```

Independent checkpoint execution uses the already installed Node.js 26.8.1 and frozen dependency versions. No runtime upgrade is part of QA. A future application CI job must use Node.js 22 or later, install with `pnpm install --frozen-lockfile --ignore-scripts`, and report its runtime. The existing GitHub Pages workflow publishes only static showcase files; it has no Node application job. Its successful deployment is not application QA evidence.

## Isolated local execution

Use a clean worktree pinned to the reviewed full commit SHA. Keep each lane's `.env.local`, `.local-stack`, `.next`, generated reports and synthetic database separate. Generate isolation with `node scripts/worktree-env.mjs <lane>` only before the lane's ports are in use. Verify that test API and app URLs match the generated metadata. Never reuse another lane's server or reset another database.

The checked-in `.env.example` uses the Supabase template's API port 54421. An isolated lane uses its generated API/app ports instead. Replace required keys from that local project's status output privately; never print or commit service-role credentials. Optional cron, webhook, outbound email and AI configuration remains blank unless separately authorized.

Database reset executes `supabase/seed.sql`. The existing seed creates a known synthetic owner and sample records: opt in only for isolated local tests. It is not a production bootstrap or safe default owner. Removing that assumption from portable installation is a remaining handover prerequisite, not a gate this checkpoint claims to have passed.

Run state-changing database tests sequentially. Apply a fresh migration replay, execute direct API tests, and run pgTAP with explicit absolute `.sql` file paths; default discovery through the runtime's test-directory symlink has stalled previously. Then run lint, types, unit tests, one production build and the browser suite against that build. Do not run dev/build/browser writers concurrently against the same `.next` directory.

## Evidence and limits

For each gate, record the exact Git SHA, branch/worktree, runtime project/ports, full command, exit code, pass/fail count, and log location. Record failed and unrun checks as such. A QA follow-up commit creates a new candidate; rerun the affected checks and identify both the supplied base and verified final commit.

Software gates do not authorize deployment, publication, production migration, customer data import or outreach. Upgrade preflight, real opening-balance reconciliation, accountant-reviewed workflows, backup/restore, portable opt-in initialization and license selection remain separate approval and release prerequisites. This QA document does not change the existing license.
