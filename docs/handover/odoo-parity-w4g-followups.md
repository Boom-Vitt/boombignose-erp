# W4-g follow-ups handover: labour-cost privacy and the record save guard

Branch `odoo-w4g-followups` from `odoo-parity` at `c5348bc`. These are the two follow-ups from review `w4d-fix1.md`. Commits are local and nothing was pushed.

## What changed

**Labour cost and project profit are staff-only.** The coordinator decided that project labour cost and project profit are management information. Before this change any member could read every project's labour total. On a project with one contributor, that total is the contributor's hourly rate times their hours. On any project, adding 60 minutes to their own entry moved the total by exactly their rate. Two places now enforce staff-only access:

- In the database, `private.project_labour_totals(uuid)` checks `private.is_org_staff` instead of `private.is_org_member`. The security-invoker view `public.project_labour_totals` reads through that function, so it returns no rows to members, just as it already did for outsiders. The new migration is `supabase/migrations/20261025150500_labour_privacy.sql`.
- On the project page, a new staff capability `profit:view` (owner and admin, matching `is_org_staff`) controls two things. Without it the page does not query the labour total, and it hides the Revenue, Cost incl. labour, Profit and Margin cards. Members still see hours logged, billable value and the time form.

I checked the other places that could show these figures and found nothing else. Reports, the dashboard, the PDF and CSV exports and the timesheets page contain no labour or profit figure for members. Timesheets loads rates only for staff, and `member_cost_rates` was already staff-only. The rate is copied into `audit_log` when it is set, but `audit_log` has been staff-only since `20261014091000`.

**A header save no longer overwrites edits typed during the save.** `useGuardedForm` (`components/record/record-guard.tsx`) used to call `form.reset(sent)` after a successful save. That replaced anything typed after Submit and marked the form clean. It now does three things:

- It takes a deep snapshot of the submitted values. `getValues()` is a shallow copy, so without the deep copy a nested edit would rewrite the snapshot.
- After the save it calls `reset(sent)`, which makes the saved values the clean baseline.
- It then calls `reset(latest, { keepDefaultValues: true })`, so edits typed during the save stay on screen and stay dirty against that baseline.

I fixed it inside the shared hook, so the invoice, quote, deal and project forms all get the fix without changes to the forms themselves. The fields stay editable while the save runs.

## Files

- `supabase/migrations/20261025150500_labour_privacy.sql` is new.
- `supabase/tests/labour_privacy.sql` is new. As owner and admin it shows that staff see the totals. As a member it shows no rows from the view or the function, no rates, unchanged access to hours, and no change in labour visible after an hour is added to their own entry. It also checks that every function callable by `authenticated` that mentions cost rates or labour contains `is_org_staff`, and that `project_labour_totals` is the only view over labour.
- `supabase/tests/time_metrics.sql` and `supabase/tests/time_metrics_fixes.sql` each had one member assertion flipped. They used to expect the member to see the total; now they expect zero rows.
- `lib/permissions.ts` adds `profit:view`. `app/(app)/projects/[id]/page.tsx` uses it.
- `lib/documents/vat-pages.test.ts` gets a role switch in its auth mock and a new member case.
- `components/record/record-guard.tsx` and the new `lib/record/guarded-form.test.ts`. The test drives a real React Hook Form 7.80 `createFormControl` through `useGuardedForm` and covers a nested edit typed while the save is pending, plus the case where nothing was typed.
- `e2e/time-metrics.spec.ts` is updated. A member gets `[]` from `project_labour_totals` over the API, sees `0.2h` on the project page and no Revenue, Cost incl. labour, Profit or Margin. The owner sees the cost card with `0.28`, plus Profit.

## SQL function ownership

- Replaced: `private.project_labour_totals(uuid)`. It was created by W4-d in `20261025110500_time_metrics_fixes.sql`. W4-d has merged, and this track is its follow-up.
- Created: none. The view `public.project_labour_totals` is unchanged.

## How it was verified

Each fix landed after a failing test, in this commit order:

- `8b97e05` then `69b5088`: the guard test failed with `notes: ""` instead of the typed text.
- `daa0a9e` then `3604254`: the nested case failed with `isDirty: false`.
- `ca29d49` then `6a7dd76`: as a member, the SQL test read 2 labour rows from the view and from the function, and listed `private.project_labour_totals(uuid)` as a function callable without a staff check.
- `38cfa71` then `6a7dd76`: the page test found a `Revenue` card for a member.

Final gates at `3604254`, on the isolated stack only (API 56201, app 3111). The sequence was `.local-stack/db-reset.sh "$PWD"`, `pnpm build`, then `pnpm e2e`:

```
$ .local-stack/db-reset.sh "$PWD"      # full pgTAP suite
Files=26, Tests=728
Result: PASS
db-check ok: 3604254
$ node --test supabase/tests/tenant-security.api.test.mjs
ℹ tests 11  ℹ pass 11  ℹ fail 0
$ pnpm lint
$ eslint                                # exit 0
$ pnpm typecheck
$ tsc --noEmit                          # exit 0
$ pnpm test
 Test Files  140 passed (140)
      Tests  1045 passed (1045)
$ pnpm build
✓ Compiled successfully in 3.7s         # exit 0
$ pnpm e2e
  ✓  29 [chromium] › e2e/time-metrics.spec.ts:16:5 › rates, labour cost and profit stay staff-only while members keep hours, and cancelled time rebills once (6.3s)
  4 skipped
  42 passed (1.3m)                      # exit 0
```

The 4 skipped specs (payment verification, two tenant-onboarding cases and accounting sync) are skipped by their own conditions and this branch did not touch them. Before this final run, four other full e2e runs each had one or two failures, on a machine with load averages of 11 to 20. The failures were `vat-wht.spec.ts` three times (twice on a 5-second poll, once on the 30-second test timeout), `facets-deals-projects.spec.ts` once, and `record-history.spec.ts` once, the last after reruns on the same database. None of these specs touch files this branch changed. In every run, `time-metrics.spec.ts` passed.

An independent reviewer (Claude Opus subagent) read the diff and searched the repository. It found no remaining labour or profit leak for members and no regression in the four guarded forms. It did find the shallow-copy problem with nested fields, fixed in `3604254`, and a check in the guard test that could never fail, made strict in `daa0a9e`.

## Open issues

- In the full e2e runs, specs this track does not touch failed intermittently, as described in the verification section above. Each one passed when repeated on its own (12/12 for the deals facets and VAT/WHT specs). `vat-wht.spec.ts` fails on 5-second `expect.poll` reads of `org_settings` after a UI save. `record-history.spec.ts` is not safe to rerun on the same database: a second `history-smoke.txt` attachment on the first client causes a strict-mode violation. These belong to the e2e stabilization track.
- The structural SQL check only catches functions that never mention `is_org_staff`. A function that mentions it but also accepts members (for example `is_org_staff(x) or is_org_member(x)`) would pass. It covers only the `public` and `private` schemas.
- Review `w4d-fix1.md` also lists `inventory/moves/page.tsx:25` (`.eq` on a multi-value kind filter). That item is outside this brief and was not changed.
