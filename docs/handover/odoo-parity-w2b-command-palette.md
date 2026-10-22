# Odoo parity w2b: Ctrl/Cmd+K command palette

## What changed

**Palette.** Ctrl+K on Windows and Linux, or Cmd+K on macOS, opens a command palette from any app page. A Search button in the top bar opens it too, and shows the shortcut for the platform. The palette is built on `components/ui/command.tsx` (cmdk) inside the base-ui dialog. It has four groups, in this order.

- **Actions.** On a quote, deal, project, invoice or subscription detail page, the palette offers what that page's StatusBar offers, such as "Mark sent", "Accept" or "Mark won". The first action is highlighted, like the StatusBar's primary button. Status changes run through `runRecordAction`. "Create project and draft invoice" calls `convertQuoteToInvoice` with the same session key scope as `ConvertQuoteButton`, so a retry from either place recovers the same invoice. Invoice "Issue invoice" and "Record payment", and the deal's "Create project", jump to the page's own control, as the StatusBar links do.
- **Go to.** Every module in `components/nav.ts`, so a new module appears without a palette change. Owner/admin-only modules are hidden from members, matching the sidebar.
- **Create.** New deal, quote, invoice, client, project and product, plus New purchase order and New vendor (added on `odoo-parity` in `5ae2be5`, gated by `purchase:manage`). Members don't see New invoice (`createInvoice` checks the role) or New product (`product:manage`).
- **Records.** Server-side search over clients (name), deals (title), quotes (number), invoices (number), projects (name) and products (name or SKU). It is a case-insensitive substring match in which every character is literal, `*` included. Results are scoped to the org, limited to 5 per type and debounced at 250 ms. A search needs at least 2 characters, checked on the server. Each user may run 60 searches a minute. A newer query discards older results.

**How record actions mirror the StatusBar.** `lib/search/record-actions.ts` runs the page's own `statusBar()` call over the same DocumentFlow tables, with the same availability rule. `recordContext` in `lib/search/actions.ts` reproduces the props each detail page passes to `<StatusBar>`: which transition it binds and which command handlers it passes, under which role, capability and state. `runRecordAction` reloads the record (org-scoped), checks that the requested status is offered right now, then calls the existing server action (`setQuoteStatus`, `updateDealStage`, `updateProjectStatus`, `setSubscriptionStatus`). Those actions keep their own validation, audit entries and revalidation.

**Row cap.** The invoice's verified-paid total is paged in 1,000-row pages until complete. The deal's linked-project check is a `head` count query.

**Accessibility.** The base-ui dialog provides the focus trap, Esc, and focus return to the element focused before opening. cmdk provides Arrow keys, Enter and `aria-activedescendant`. The dialog is named "Command palette" and has a description. The combobox is named "Search commands and records". Icons are `aria-hidden`. The trigger has `aria-keyshortcuts`.

## Fix round 1

Three should-fix findings from the independent Codex review.

**Server-side search throttle.** `searchRecords` runs six substring scans per call. The 250 ms debounce lives in the browser, so a signed-in user could post the server action in a loop and make the app run six scans per request with no limit. Now, after the 2-character minimum (unchanged, enforced in `searchQueries` before any database work), the action calls `take_search_slot()` before the fan-out. That security-definer function counts calls per user per calendar minute in `private.search_throttle` (an atomic upsert) and refuses past 60. The palette then shows "Too many searches. Wait a minute and try again." The count lives in Postgres, so every app instance shares it. Each call deletes that user's earlier minutes, so the table holds about one row per active user. `authenticated` may call the function but cannot read or write the table, and `anon` cannot call it.

What it protects against is a user, or a script holding a user's session, using the palette's server action to amplify load. Each allowed call costs at most six scans that return 5 rows each, so one user can cause at most 360 scans a minute through this path. What it does not cover. A fixed window allows up to 120 calls across a minute boundary. It does not limit direct PostgREST reads made with the user's own JWT and the public anon key, which RLS already scopes to the user's org and which Supabase's platform limits govern. It is not a defence against a distributed attack from many accounts.

**Late Actions answer no longer steals the selection.** The palette used to highlight the first StatusBar action when `recordActions` resolved, unless the user had typed a term of 2 or more characters. Arrowing to "Quotes" before the answer arrived, then pressing Enter, ran "Mark sent" instead of navigating. Now any keydown in the palette, a pointer move over the list, or a query change marks the opening as touched, and a late answer only fills the Actions group. Each opening resets the flag.

**Literal `*` in record search.** PostgREST rewrites every `*` in a `like`/`ilike` value to `%`, and no escape survives that rewrite. The filter is now `column.imatch."***=<term>"`. `imatch` is Postgres `~*` (case-insensitive regex), and the ARE director `***=` makes the rest of the pattern a literal string. `%`, `_`, `\` and `*` are all literal, with no escaping code left. The JSON-quoted value still keeps `,`, `.`, `"` and `()` from adding filter conditions. Neither `ilike '%…%'` nor this can use a btree index, so the scan cost is unchanged.

## Files

- `lib/search/query.ts` and `query.test.ts` hold the search sources, LIKE escaping and the PostgREST `or` filter.
- `lib/search/commands.ts` and `commands.test.ts` build the nav and create commands, filtered by role.
- `lib/search/record-actions.ts` and `record-actions.test.ts` parse the record from the path and list the StatusBar actions.
- `lib/search/actions.ts` and `actions.test.ts` hold the `searchRecords`, `recordActions` and `runRecordAction` server actions.
- `components/command-palette/command-palette.tsx` is the client palette and its trigger button.
- `app/(app)/layout.tsx` gets one import and one mount line in the header.
- `components/ui/command.tsx` moves `CommandDialog`'s sr-only title and description inside `DialogContent`. This is outside the ownership list. Base-ui renders a title placed outside the popup in place, so "Command palette" sat as a hidden heading in the top bar on every page. The palette is the only `CommandDialog` user.
- `e2e/command-palette.spec.ts` is new.
- `supabase/migrations/20261024110000_search_throttle.sql` and `supabase/tests/search_throttle.sql` add the throttle (fix round 1).

The pure logic lives in `lib/search/` rather than `components/command-palette/`, because Vitest only collects `lib/**/*.test.ts`.

## Verification

**Gates.** All four pass on the final tree. These are the final lines of each.

```
$ pnpm lint
$ eslint
exit 0

$ pnpm typecheck
$ tsc --noEmit
exit 0

$ pnpm test
 Test Files  94 passed (94)
      Tests  662 passed (662)
exit 0

$ pnpm build
✓ Compiled successfully in 5.0s
  Finished TypeScript in 7.0s ...
✓ Generating static pages using 17 workers (20/20) in 252ms
exit 0
```

**Unit tests (14 new).** They cover the following.

- Nav to commands, and capability filtering for owner, admin and member.
- The search query builder: per-type tables and filters, the 5-row limit, `%`, `_` and `\` escaping, quoting of `,`, `"`, `.` and `()`, and short or blank terms.
- Path parsing, including seeded non-v4 ids.
- StatusBar parity cases.
- The server actions with a mocked Supabase:
  - a status that isn't offered is refused;
  - members can't change subscription status;
  - invoice commands go to staff only;
  - every search query filters on `org_id`.

**Browser.** No Supabase stack runs in this worktree, so the authenticated app could not render. I mounted the palette on a temporary public page (deleted, never committed) as a member, under `next dev` with dummy Supabase env, and drove it with headless Chromium. Results:

- Ctrl+K opens and toggles the palette.
- The input is focused on open.
- Members see no New invoice, New product or Activity.
- Arrow Down three times reaches Quotes, and Enter navigates to `/quotes`.
- Tab and Shift+Tab stay on the input.
- Esc returns focus to the element focused before opening.
- Ctrl+K with a Thai layout (`key: "ร"`, `code: "KeyK"`) opens it.
- The hidden title is absent while the palette is closed.
- There were no console or hydration errors.

**Not run.** `e2e/command-palette.spec.ts` needs the seeded local stack, and was not run here.

## Review

An independent reviewer read the diff against the five detail pages. It confirmed StatusBar parity and the trust boundary, and found the issues fixed in `491aeb9`:

- the strict `z.uuid()` rejected seeded ids;
- the hidden dialog title rendered in the top bar;
- the Thai-layout shortcut didn't fire;
- the action highlight, the blocked-storage conversion key, Zod on `recordActions`, and an e2e hydration race.

## Fix round 1 verification

All of this ran on an isolated Supabase stack started for this worktree (`odoo-w2b-db`: API `127.0.0.1:55801`, app `127.0.0.1:3108`). Its config is a copy of the e2e stack's, with the ports moved. The shared `odoo-parity-db` and `odoo-e2e-db` stacks only got read-only queries.

**Gates.** All four pass on the final tree.

```
$ pnpm lint        exit 0
$ pnpm typecheck   exit 0
$ pnpm test
 Test Files  108 passed (108)
      Tests  757 passed (757)
$ pnpm build
✓ Compiled successfully
✓ Generating static pages using 17 workers (22/22)
```

**SQL.** `supabase db reset` applied every migration and the seed, then `supabase test db` ran all files: `Files=15, Tests=280, Result: PASS`. `search_throttle.sql` covers the following. `anon` cannot call `take_search_slot`. `authenticated` cannot touch `private.search_throttle`. 60 calls are allowed in a minute and the 61st is refused. Each user has their own budget. A new minute refills the budget and prunes past rows.

**Selection race.** The new e2e test holds the `recordActions` server action with `page.route`, arrows to "Quotes", releases the answer, then checks that "Quotes" is still selected and that Enter goes to `/quotes`. With the old guard restored (`!latest.current`), it fails as the review describes.

```
✘ a late Actions answer keeps the option the user arrowed to
  Locator: getByRole('dialog', { name: 'Command palette' }).getByRole('option', { name: 'Quotes', exact: true })
  Expected: "true"
  Received: "false"
```

With the fix it passes.

**Literal `*`.** Through PostgREST on the e2e stack, read-only, `or=(name.ilike."%*o*e%")` returned "Doi Chang Origin Coffee" and "Siam Property Hub". `or=(name.imatch."***=*o*e")` returned `[]`. The new e2e test inserts decoy clients `<tag> q{*,%,_,\,.,",A}7`, runs each term through `searchQueries` and PostgREST, and expects exactly the one literal row. It deletes the decoys afterwards. With the old `ilike` builder restored, the `*` case fails.

```
✘ record search filters match *, %, _, \, . and quotes literally through PostgREST
  + Received + 6   ("… q.7", "… qA7", "… q\"7", "… q_7", "… q%7", "… q\\7")
```

With the fix it passes. Unit tests pin the filter strings, including `***=*Z` and the quoting of `,`, `"`, `.` and `()`.

**Throttle in the app.** A throwaway spec (not committed) filled the demo user's budget in SQL, then searched from the palette. It saw "Too many searches. Wait a minute and try again." and no record options. The rows were deleted afterwards. Unit tests check that the action takes a slot before any table query, stops when none is left, and spends no slot on a term under 2 characters.

**E2E.** `pnpm e2e` on the isolated stack, community edition: `33 passed`, `4 skipped` (the Pro-only guards from `odoo-e2e-fix`). `e2e/command-palette.spec.ts` now has four tests: keyboard smoke, the selection race, record search by name, and the literal-match check. This also closes the first round's open issue. Record search and the Actions group now run against a real database, on a sent quote.

**Review.** An independent Codex review (`gpt-6.1-sol`, xhigh, read-only) of the uncommitted diff found nothing blocking. It raised one coverage point. The `*` tests only checked strings, so a PostgREST-level regression would go unnoticed. The live literal-match e2e test above was added for that.

## Open issues

- Search includes archived products, with no marker.
- On a record page the Actions group appears a moment after the palette opens, once its server action returns. A late answer no longer moves the selection, but the first action is only highlighted if the user hasn't touched the palette yet.
- `lib/products/search.ts`, the clients list `q` filter and the deals CSV export still use `ilike`, so a `*` there is a wildcard. They are outside this track. The deals export also passes `q` unescaped.
- The throttle limits the palette's server action only. Direct PostgREST reads with a user's own JWT are limited by RLS and Supabase's platform limits, not by this throttle.
