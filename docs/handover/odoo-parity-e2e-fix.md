# E2E fix handover

2026-10-23. Branch `odoo-e2e-fix`, based on `odoo-parity` `e3d55c2`, then merged with `odoo-parity` `2407c61` (includes `9cc0cb7`: purchasing, web-to-lead and the t1/t2/t3/t5 review fixes). Isolated stack: API `127.0.0.1:55701`, app `127.0.0.1:3106`, `BBN_EDITION=community`.

## Failures and fixes

The first integration run failed 9 of 31 specs. Each one is listed below with its classification and fix.

| Spec | Classification | Cause | Fix |
| --- | --- | --- | --- |
| `record-history.spec.ts` (Log note) | Regression (app bug in T2 record history) | Zod 4 `z.uuid()` enforces RFC 9562 version and variant bits. Seeded ids such as `c0000000-0000-0000-0000-000000000001` failed `RecordInput`, so every note on a seeded record was rejected before the insert. The UI did show an alert, but it blamed the note ("Enter a note of 1 to 20,000 characters."). Seeded user ids (`b0000000-...`) failed `ScheduleInput.owner` the same way. | `RecordInput.recordId` and `ScheduleInput.owner` use `z.guid()`, as the finance actions already do for database ids. An invalid target now reports "This record is not available. Reload the page and try again." instead of a note-length error. |
| `kanban.spec.ts` (deals board, projects board) | App accessibility bug, surfaced by new specs | Base UI `Button` forces `role="button"` on whatever `render` swaps in. Every `Button render={<Link>}` in the app (about 50 sites, all links) exposed navigation as a button. Base UI's docs say links must not be rendered through `Button`. | `components/ui/button.tsx` renders a `render` element with Base UI `useRender`, keeping the button classes and `data-slot`, so links keep link semantics. The `render` prop is typed as a `ReactElement`, which is how every caller uses it. Specs unchanged. |
| `search-charts.spec.ts` (facet chips, chart switcher) | Same as above | Facet chips, group-by entries and the chart switchers are `Button render={<Link>}`. | Same `Button` fix. Specs unchanged. |
| `purchasing.spec.ts` (New purchase order), reported after the merge | Same as above | "New purchase order" is `Button render={<Link>}`. | Same `Button` fix. Spec unchanged and passing. |
| `payment-verification.spec.ts` | Pre-existing (fails on `b4d9d69`) | The client portal is Pro-only. On community, `PortalPage` calls `notFound()`. | `test.skip(community, ...)` via `e2e/edition.ts`. |
| `tenant-onboarding.spec.ts` (switch two memberships) | Pre-existing (fails on `b4d9d69`) | The workspace switcher is Pro-only, so the community header has no switcher button. | Same skip guard. |
| `tenant-onboarding.spec.ts` (zero-membership provisioning) | Pre-existing (fails on `b4d9d69`) | Community `provision_workspace` refuses once any organization exists (commit `1b2df19`), and the seed always has the demo org. The test expects Pro hosted provisioning. | Same skip guard. |
| `v2-batch2.spec.ts` (accounting connect) | Pre-existing (fails on `b4d9d69`) | Accounting integrations are Pro-only. On community, `AccountingSettingsPage` calls `notFound()`. | Same skip guard. |

`e2e/edition.ts` resolves the edition the way `next.config.ts` does at build time. The shell `BBN_EDITION` wins, then `.env.local`, then `community`.

## Baseline check

I created a detached worktree at `b4d9d69` in `$TMPDIR/erp-baseline`, installed, copied `.env.local` and `.local-stack/isolation.json`, built, reset this stack with `.local-stack/db-reset.sh` on it, and ran the three pre-existing spec files. Result: the same 4 tests failed with the same errors (`4 failed`, `3 passed`). The stack was then reset back to this branch.

## Pro check of the guarded tests

With `BBN_EDITION=pro pnpm build`, `ee/supabase/provision-hosted-workspace.sql` applied to this stack's database, and `BBN_EDITION=pro` set for Playwright, all 7 tests in the three guarded files passed (`7 passed (18.9s)`). The guards hide only edition-gated behavior.

## Files

- `lib/record-history/input.ts`, `lib/record-history/actions.ts`, plus tests in `lib/record-history/input.test.ts` and `lib/record-history/actions.test.ts`. The failing test is committed before the fix.
- `components/ui/button.tsx`.
- `e2e/edition.ts`, `e2e/payment-verification.spec.ts`, `e2e/tenant-onboarding.spec.ts`, `e2e/v2-batch2.spec.ts`.
- The merge with `odoo-parity` conflicted only in `lib/record-history/input.test.ts`, where both sides added an independent test. Both are kept. The t2 `TimelinePageInput` extends `RecordInput`, so older-history paging on seeded records also gets the `z.guid()` fix.

## Verification

All gates below ran on the merged branch. `pnpm e2e` on community, after `.local-stack/db-reset.sh "$PWD"` and `pnpm build`:

```text
  4 skipped
  31 passed (34.9s)
```

The 4 skipped tests are the Pro-only ones above. Before the merge the same suite gave `4 skipped`, `27 passed`.

`pnpm lint` exited 0:

```text
$ eslint
```

`pnpm typecheck` exited 0:

```text
$ tsc --noEmit
```

`pnpm test` exited 0:

```text
 Test Files  108 passed (108)
      Tests  755 passed (755)
```

`pnpm build` exited 0:

```text
✓ Compiled successfully in 4.1s
✓ Generating static pages using 17 workers (22/22) in 205ms
```

## Open issues

- The same strict-id bug exists outside record history. These schemas use `z.string().uuid()` on database ids, which rejects seeded ids (checked against Zod 4.4.3 directly; I did not drive these UI paths): `ContactInput.client_id` in `app/(app)/clients/actions.ts` (adding a contact to a seeded client), `DealInput.clientId` in `app/(app)/deals/actions.ts` (creating or editing a deal for a seeded client), `ActivityInput.dealId` in the same file (logging a deal activity), and `TemplateInput.categoryId` in `app/(app)/templates/actions.ts`. I did not change them because concurrent tracks own clients and deals. The fix is `z.guid()` for database ids, keeping `z.uuid()` for client-generated idempotency keys.
- The community suite never runs the four Pro tests. Running them needs a Pro build plus the hosted provisioning SQL, as described above.
