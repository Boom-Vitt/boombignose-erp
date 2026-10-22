# Record history and scheduled activities

Implemented 2026-10-23 in the t2-record-history worktree.

## Behavior

All six record detail pages mount a shared history section at the end of their body. Users can log internal notes, schedule an assigned activity, attach a private file, and mark planned activities done. A dated timeline combines notes, attachments, completed activities, and permitted audit entries. Status transitions display the previous and next state. The app header links to a personal activity queue with late, today, and future counts.

Due state has one pure implementation using the Bangkok calendar day. Existing client/deal activity views, dashboard follow-ups, calendar activity chips, and the new queue/history share it. Labels accompany the red/orange/green colors.

## Data and security

The Model the Domain principle led to a typed `RecordRef` and a six-entry table/route registry shared by validation, actions, and links. Existing house components and dependencies cover the UI; no new abstraction or package was needed for individual record kinds.

- `supabase/migrations/20261023120000_record_history.sql` adds the six-value record type, record references, completion timestamps, record/owner indexes, note and attachment tables, forced RLS, a private bucket, and org-scoped Storage policies.
- A database compatibility trigger backfills and synchronizes legacy client/deal links. Existing deal inserts, client links, deal detach, completion, and reopening remain supported. Unrelated edits cannot move completion timestamps. Polymorphic targets and assignees must belong to the same org.
- The guarded `record_activity_assignees` RPC returns only workspace user IDs and names. The existing memberships policy exposes only the current user's membership, so direct membership reads cannot implement teammate assignment.
- `record:write` is available to owners, admins, and members. Server Actions validate inputs with Zod, require the capability, and scope reads and mutations to the active org. Existing staff-only audit visibility is retained and explained in the UI.
- Uploads accept PDF, JPEG, PNG, WebP, text, and CSV up to 10 MB. Paths are generated from org/type/record/attachment IDs, upload ownership is enforced, and failed metadata saves attempt object cleanup. Downloads require an active-org lookup and a 60-second signed URL with download disposition. Retained attachment objects and metadata are append-only through authenticated policies.
- `next.config.ts` increases the action body envelope to 11 MB so a validated 10 MB multipart file can reach the action.
- Quote, invoice, project, and subscription status updates append explicit from/to audit metadata. Existing authored audit messages remain intact.

## Files

- `lib/record-history/{model,due,input,timeline,queries,actions}.ts` and their focused unit tests own the shared domain, reads, and mutations.
- `components/record/record-history.tsx` and `activity-{composer,due,done,attachment,counter}.tsx` own the UI.
- `app/(app)/activities/page.tsx` owns the personal queue; the app layout has one counter mount.
- Quotes, invoices, deals, projects, clients, and subscriptions detail pages each have one history mount plus its import. The client page also reuses the due display in its existing activity list.
- Existing deal activity rendering, dashboard follow-ups, calendar page/chip types/legend receive focused due-color updates.
- Shared generated database declarations and permission declarations/tests are additive.
- `supabase/tests/record_history.sql` covers forced RLS, author/uploader forgery, cross-org reads/writes, dual-org record forgeries, all record kinds, teammate resolution, legacy inserts/detach, completion/reopen, status metadata, private Storage paths/ownership/read/delete/cleanup.
- `e2e/record-history.spec.ts` covers note creation, attachment upload, scheduling, personal queue navigation, and completion on the seeded integration stack.

## Initial delivery validation

The full unit suite includes existing client/deal active-workspace and activity-related tests. All four required gates passed with exit code 0. Final output excerpts follow.


### pnpm lint

```text
$ eslint
```

Exit code 0.


### pnpm typecheck

```text
$ tsc --noEmit
```

Exit code 0.


### pnpm test

```text

 Test Files  76 passed (76)
      Tests  548 passed (548)
   Start at  02:01:15
   Duration  3.79s (transform 6.03s, setup 0ms, import 40.51s, tests 1.53s, environment 4ms)
```

Exit code 0.


### pnpm build

```text

ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Exit code 0.


An independent read-only reviewer approved the application and storage/SQL patch after the teammate-RLS, private-schema-USAGE, and quote-fixture findings were fixed. The reviewer ran focused Vitest tests, scoped lint, and diff checks. Its verdict is static review of SQL, not an executed migration result.

## Initial delivery integration checks and limits

No Supabase or Docker service was started. The migration and pgTAP SQL file were not executed in this worker, and the Playwright smoke requires the coordinator's seeded integration database, so it was written but not run. Apply the migration before serving the updated app, run the SQL tests on the integration stack, then run `pnpm e2e -- e2e/record-history.spec.ts` there. The SQL test sets the transaction-local Storage deletion flag to exercise authenticated cleanup policies without bypassing RLS.

Client deletion still has the repository's existing database cascade behavior for legacy activity rows, despite older UI copy saying activities are kept. This track does not change that deletion contract. Activities linked only polymorphically can still be marked done after their target is deleted; deleted targets have no detail page or attachment download surface.

No new npm dependency, push, merge, deployment, or external publication was performed. Local project memory was initialized and updated in this worktree and remains ignored by Git under the repository's existing convention.


## Fix round 1, 2026-10-23

The coordinator reports that the original migration and SQL suite passed 141 integration assertions. Its subscription-fixture amount correction in commit `763e551` is retained. The applied `20261023120000_record_history.sql` migration is unchanged.

Completion attribution now uses `completed_by`, not the assignee. The new `20261023120500_activity_completion.sql` migration adds the actor column and a completion-stamp trigger. The action explicitly supplies the signed-in actor and time; the trigger records `auth.uid()` and database time for every completion path, preserves both on unrelated edits or repeated completion, and clears them on reopening. Existing historical completers remain unknown rather than being guessed from the assignee. `supabase/tests/activity_completion.sql` covers teammate completion, forged actor/time inputs, legacy inserts and toggles, idempotence, reopen/recompletion, and org isolation.

Planned activities and the personal queue query only open activities using 500-row UUID keyset batches. Completed rows cannot crowd them out, and the open list does not stop at the API cap. The app counter now uses three scoped queries with `head: true` and `count: 'exact'`, so totals do not depend on downloaded rows.

Timeline sources each query the newest 51 rows and merge into 50-entry pages. A typed timestamp/entry-ID cursor preserves the full database timestamp, orders equal timestamps by kind and UUID, and validates every Load older request. The pure comparator retains PostgreSQL microseconds. The Load older control retains its cursor on failure and resets loaded pages on a refreshed server render, including when a reopened activity was older than page one. Each request rechecks org context and audit visibility.

Calendar chip text now includes `Completed` or `Pending` with `Overdue`, `Today`, or `Future`; users can distinguish states without the dots' colors.

Additional files are `components/record/activity-timeline.tsx` and `lib/record-history/calendar.test.ts`. Existing history queries, actions, cursor validation, timeline helpers/tests, counter/history components, calendar mapping, and database activity types contain focused updates.

### Reproduction and verification

Failing regressions were committed first as `05bda90`. Before the fix, the capped API fixture reproduced these failures:

```text
expected 'alice' to be 'bob'
expected [] to deeply equal [ 'open-new' ]
expected [ Array(1000) ] to have a length of 1205 but got 1000
expected 'Note 999' to be 'Note 1204'
Test Files  2 failed | 74 passed (76)
Tests  6 failed | 548 passed (554)
```

The fixed tests also traverse more than 1,000 history rows across all four sources, exact-time ties, sub-millisecond timestamp boundaries, and notes arriving between pages. Counter fixtures return a count only when `count: 'exact'` is actually requested. Calendar tests assert the visible status text. Cursor boundary tests reject filter injection and preserve six-digit fractional timestamps.

Independent read-only review approved the final changes after inspecting trigger ordering, cursor ordering, RLS, exact counts, and refreshed client state. It ran 35 focused tests and diff checks successfully. This is static SQL/UI review, not database or browser execution.

### Final application gates

All four commands passed with exit code 0 on the final source. Final output excerpts follow.

`pnpm lint`

```text
$ eslint
```

Exit code 0.

`pnpm typecheck`

```text
$ tsc --noEmit
```

Exit code 0.

`pnpm test`

```text

 Test Files  77 passed (77)
      Tests  559 passed (559)
   Start at  02:20:39
   Duration  7.68s (transform 12.79s, setup 0ms, import 94.12s, tests 2.22s, environment 5ms)
```

Exit code 0.

`pnpm build`

```text

ƒ Proxy (Middleware)

ƒ  (Dynamic)  server-rendered on demand
```

Exit code 0.

### Integration follow-up

No database or Docker service was started in this worker. Apply `supabase/migrations/20261023120500_activity_completion.sql` on the integration database, then run `supabase/tests/activity_completion.sql` together with the existing SQL suite and browser smoke. The new migration/SQL assertions and browser behavior were not executed here. No dependency, push, merge, or deployment was added.
