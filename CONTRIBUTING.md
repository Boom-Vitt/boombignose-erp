# Contributing

Issues, documentation fixes, tests, and focused pull requests are welcome.
Please discuss substantial feature or licensing-boundary changes in an issue
before implementation.

## Required contributor agreement

Before submitting a contribution, read and agree to the
[Individual Contributor License Agreement](CLA.md). Check the CLA acceptance
box in the pull request template. Contributions without affirmative CLA
acceptance cannot be merged. The acceptance record covers the submitted
contribution; do not assume an older contribution was covered retroactively.

You retain copyright and grant BoomBigNose AI Co., Ltd. the right to use and
relicense your contribution under open-source and commercial terms. Confirm
you have authority to grant those rights, including any required employer
permission. Disclose third-party sources and licenses; the CLA cannot relicense
third-party work. Do not submit secrets or private/customer material.

## Scope and implementation

Read [the strategy](docs/OPEN_CORE_STRATEGY.md) and
[the implementation boundary](docs/OPEN_CORE_BOUNDARY.md). Keep Community work
in the existing core modules and Pro implementation/tests under `ee/`.
BoomBigNose is a separate proprietary product in `bignose/`; do not copy it into
the ERP Community Edition. Preserve third-party notices listed in [NOTICE](NOTICE).

Reuse the existing TypeScript, React, Zod, Supabase/RLS, and UI conventions.
Keep tenant scope, permission checks, validation, accessibility, error handling,
and integer-satang money calculations intact. Add focused tests for new logic
or changed behavior. Keep single-org setup and ordinary team invitations in Community.

## Local checks

Use Node.js 22 or later and pnpm. From the repository root, run:

```sh
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
pnpm lint
pnpm test
pnpm build
```

The default build is Community. Use `BBN_EDITION=pro pnpm build` and
`pnpm exec tsc --noEmit -p tsconfig.pro.json` to verify Pro as well.
The ERP suite includes both `lib/**/*.test.ts` and `ee/**/*.test.ts` and needs
no live database. Integration/browser tests require a separate isolated local
Supabase setup; see [the QA gates](docs/testing/erp-gates.md). BigNose has its
own workspace and checks; root ERP checks do not validate it.

Describe the problem, implementation, tests actually run, and any remaining
limits in your pull request. Follow [TRADEMARK.md](TRADEMARK.md) for forks and
[COMMERCIAL-LICENSE.md](COMMERCIAL-LICENSE.md) for license scope. Report
security problems privately as described in [SECURITY.md](SECURITY.md).
Licensing questions can be directed through https://boombignose.org.
