# W4-g follow-ups handover: labour-cost privacy and the record save guard

Branch `odoo-w4g-followups` from `odoo-parity` at `c5348bc`. These are the two follow-ups from review `w4d-fix1.md`, plus fix round 1 from review `w4g.md`. Before fix round 1 the branch merged `odoo-parity` at `87851f8`, which already contained it, so the merge was a fast-forward. Commits are local and nothing was pushed.

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

**A record action no longer runs over edits typed during its own save (fix round 1).** Review `w4g.md` found that the fix above did not cover saves started by a record action. Clicking Accept on a dirty quote saves the header first. If the user typed notes while that save ran, the reset kept the notes dirty, but `commit()` still returned true. The guard then ran Accept, and the refresh replaced the quote form with the read-only accepted view, which dropped the notes. The browser check reproduced this before the fix: the quote ended Accepted, with the first notes saved and the typed notes gone.

`commit()` now compares the values on screen after the save with the values it sent. When they differ it returns false. The guard already treats false as unsaved, so the action does not run, and the user sees "Nothing ran because some of your changes are not saved yet. Save them, then try again." The typed edits stay on screen and stay dirty, so the next click saves them and then runs the action. The old toast said the changes "could not be saved", which is wrong when the save worked and newer edits remain, so the text now covers both cases. The fix is in the shared hook again, so every record action that saves the header first (status moves, email and convert) stops the same way on all four guarded forms. The compare uses `JSON.stringify`, which is exact for these forms because their values are strings, numbers and booleans; a code comment marks the limit. I chose to stop rather than save again and continue, because the user may still be typing, and on Accept the form becomes read-only, so a half-typed note would be saved with no way to finish it.

## Files

- `supabase/migrations/20261025150500_labour_privacy.sql` is new.
- `supabase/tests/labour_privacy.sql` is new. As owner and admin it shows that staff see the totals. As a member it shows no rows from the view or the function, no rates, unchanged access to hours, and no change in labour visible after an hour is added to their own entry. It also checks that every function callable by `authenticated` that mentions cost rates or labour contains `is_org_staff`, and that `project_labour_totals` is the only view over labour.
- `supabase/tests/time_metrics.sql` and `supabase/tests/time_metrics_fixes.sql` each had one member assertion flipped. They used to expect the member to see the total; now they expect zero rows.
- `lib/permissions.ts` adds `profit:view`. `app/(app)/projects/[id]/page.tsx` uses it.
- `lib/documents/vat-pages.test.ts` gets a role switch in its auth mock and a new member case.
- `components/record/record-guard.tsx` and the new `lib/record/guarded-form.test.ts`. The test drives a real React Hook Form 7.80 `createFormControl` through `useGuardedForm` and covers a nested edit typed while the save is pending, plus the case where nothing was typed.
- Fix round 1 changes `components/record/record-guard.tsx` (`commit()` and the toast text) and the `GuardedForm` contract comment in `lib/record/guard.ts`. `lib/record/guarded-form.test.ts` now runs the hook's effects, so the form registers with the real `recordGuard`, and adds two cases. In the first, Accept waits on the save, notes are typed meanwhile, and Accept must not run. In the second, nothing is typed, and Accept runs once. `e2e/tenant-onboarding.spec.ts` adds a browser check that holds the header save request, types notes, releases it, and then checks the toast, the database (still `sent`, first notes saved) and the notes field. A second Accept then saves the typed notes and accepts.
- `e2e/time-metrics.spec.ts` is updated. A member gets `[]` from `project_labour_totals` over the API, sees `0.2h` on the project page and no Revenue, Cost incl. labour, Profit or Margin. The owner sees the cost card with `0.28`, plus Profit.

## SQL function ownership

- Replaced: `private.project_labour_totals(uuid)`. It was created by W4-d in `20261025110500_time_metrics_fixes.sql`. W4-d has merged, and this track is its follow-up.
- Created: none. The view `public.project_labour_totals` is unchanged.
- Fix round 1 creates or replaces no SQL function.

## How it was verified

Each fix landed after a failing test, in this commit order:

- `8b97e05` then `69b5088`: the guard test failed with `notes: ""` instead of the typed text.
- `daa0a9e` then `3604254`: the nested case failed with `isDirty: false`.
- `ca29d49` then `6a7dd76`: as a member, the SQL test read 2 labour rows from the view and from the function, and listed `private.project_labour_totals(uuid)` as a function callable without a staff check.
- `38cfa71` then `6a7dd76`: the page test found a `Revenue` card for a member.
- `a21a6bc` then `7131d10` (fix round 1): the guard test failed with `expected 'done' to be 'unsaved'`, meaning Accept ran. On a pre-fix build the browser check failed at the toast, and the page snapshot showed the quote Accepted with Notes `Saved by Accept`. After the fix the browser check passed 5 of 5 runs with `--repeat-each 5`.

Final gates for fix round 1 at `7131d10`, on the isolated stack only (API 56201, app 3111). The previous round's gates at `3604254` all passed, with 42 e2e tests passing.

```
$ .local-stack/db-reset.sh "$PWD"      # full pgTAP suite
Files=32, Tests=1025
Result: PASS
db-check ok: 7131d10
$ node --test supabase/tests/tenant-security.api.test.mjs
ℹ pass 11  ℹ fail 0
$ pnpm lint
$ eslint                                # exit 0
$ pnpm typecheck
$ tsc --noEmit                          # exit 0
$ pnpm test
 Test Files  148 passed (148)
      Tests  1177 passed (1177)
$ pnpm build
✓ Compiled successfully in 3.4s         # exit 0
$ pnpm e2e                              # best of 5 full runs, each on a fresh db-reset
  ✓  27 [chromium] › e2e/tenant-onboarding.spec.ts:135:1 › Accept stops over notes typed while its save is pending, then accepts once they are saved (1.5s)
  1 failed
  4 skipped
  46 passed (1.6m)                      # exit 1
```

**The full e2e gate did not pass cleanly.** Each of 5 full runs had exactly one test fail on the 30-second timeout. Three were `time-metrics.spec.ts`, one was `v2-batch2.spec.ts:70` (AI features without a key) and one was `v2.spec.ts:18` (invoices CSV). The new Accept check passed in all 5 runs. Each failing test passed when run alone: `time-metrics` 3 of 3, the AI test 3 of 3, and `tenant-onboarding` plus `time-metrics` back to back twice.

I traced the cause to the local auth service, not to this branch. GoTrue logged 276 database connection failures in the hour, each `dial tcp …:5432: connect: cannot assign requested address`, and the auth container held about 5,500 sockets in `TIME_WAIT`. Its ports run out in bursts. Those bursts came at 22:18:56Z, 22:22:58Z, 22:27:58Z, 22:31:57Z and 22:34:53Z, one in each full run. In run 5 the burst includes the failed password grant of the stuck sign-in. For runs 1 to 4, I inferred from run timing that the burst fell inside the failing test. A failed `/user` check makes the middleware treat the user as signed out, so the page drops to `/login`. A failed password grant (`/token`, status 500) leaves sign-in stuck. The failures match. Three snapshots show the login page and one shows "This page couldn't load" after a navigation. The fifth failure is stuck in `loginDemo`, waiting for `/dashboard`. PostgREST logged no such failure. Load averages during the runs were 6 to 29.

An independent reviewer (Claude Opus subagent) read the diff and searched the repository. It found no remaining labour or profit leak for members and no regression in the four guarded forms. It did find the shallow-copy problem with nested fields, fixed in `3604254`, and a check in the guard test that could never fail, made strict in `daa0a9e`.

## Open issues

- Out of scope by coordinator decision: members can still compute project profit from the invoices and costs they are allowed to read. Review `w4g.md` rated this a blocker. For example, with no time entries labour is zero, so an issued invoice and the project costs give the profit exactly. Hiding the profit cards is a presentation choice. The secret this track protects is each person's labour cost rate. Rates stay unreadable and cannot be inferred, because labour totals and profit are staff-only. Invoice and cost visibility were not changed.

- Still open, and older than this branch: edits typed while the record action itself runs, after its save has finished, are lost. An independent reviewer (Claude Opus subagent) found this while reviewing fix round 1. For example, on a sent quote with a saved header, click Accept and type into Notes while `setQuoteStatus` runs. The action completes, the refresh makes the quote read-only, and `QuoteForm` unmounts with the typed notes. Fix round 1 covers only the save window, because an action already sent to the server cannot be stopped. Closing this gap means either disabling the header fields while a record action runs, which reverses the decision above to keep them editable, or warning after the action. That is a product call for the coordinator. The same reviewer found no blocker in fix round 1.
- The full e2e gate is not clean on this machine, because the local GoTrue container runs out of ports, as described in the verification section above. Likely fixes are keeping GoTrue's database connections open between requests, or enabling TCP `TIME_WAIT` reuse in the stack. Both belong to the stack or the e2e stabilization track, not this one, so I changed neither. The coordinator accepted fix round 1 with this gate result. According to the coordinator, the port exhaustion is already root-caused and fixed on the e2e-stable branch, which replaces the middleware's per-request `getUser` with `getClaims` in `lib/supabase/middleware.ts`. The coordinator will re-run the full suite after that branch lands.
- In the previous round's full e2e runs, specs this track does not touch failed intermittently, as described in the verification section above. Each one passed when repeated on its own (12/12 for the deals facets and VAT/WHT specs). `vat-wht.spec.ts` fails on 5-second `expect.poll` reads of `org_settings` after a UI save. `record-history.spec.ts` is not safe to rerun on the same database: a second `history-smoke.txt` attachment on the first client causes a strict-mode violation. These belong to the e2e stabilization track.
- The structural SQL check only catches functions that never mention `is_org_staff`. A function that mentions it but also accepts members (for example `is_org_staff(x) or is_org_member(x)`) would pass. It covers only the `public` and `private` schemas.
- Review `w4d-fix1.md` also lists `inventory/moves/page.tsx:25` (`.eq` on a multi-value kind filter). That item is outside this brief and was not changed.
