# Odoo parity w2b: Ctrl/Cmd+K command palette

## What changed

**Palette.** Ctrl+K on Windows and Linux, or Cmd+K on macOS, opens a command palette from any app page. A Search button in the top bar opens it too, and shows the shortcut for the platform. The palette is built on `components/ui/command.tsx` (cmdk) inside the base-ui dialog. It has four groups, in this order.

- **Actions.** On a quote, deal, project, invoice or subscription detail page, the palette offers what that page's StatusBar offers, such as "Mark sent", "Accept" or "Mark won". The first action is highlighted, like the StatusBar's primary button. Status changes run through `runRecordAction`. "Create project and draft invoice" calls `convertQuoteToInvoice` with the same session key scope as `ConvertQuoteButton`, so a retry from either place recovers the same invoice. Invoice "Issue invoice" and "Record payment", and the deal's "Create project", jump to the page's own control, as the StatusBar links do.
- **Go to.** Every module in `components/nav.ts`, so a new module appears without a palette change. Owner/admin-only modules are hidden from members, matching the sidebar.
- **Create.** New deal, quote, invoice, client, project and product. Members don't see New invoice (`createInvoice` checks the role) or New product (`product:manage`). No purchase-order route exists yet, so there is no New purchase order. A `shortcut:` comment marks where it goes.
- **Records.** Server-side search over clients (name), deals (title), quotes (number), invoices (number), projects (name) and products (name or SKU). Results are scoped to the org, limited to 5 per type and debounced at 250 ms. A search needs at least 2 characters. A newer query discards older results.

**How record actions mirror the StatusBar.** `lib/search/record-actions.ts` runs the page's own `statusBar()` call over the same DocumentFlow tables, with the same availability rule. `recordContext` in `lib/search/actions.ts` reproduces the props each detail page passes to `<StatusBar>`: which transition it binds and which command handlers it passes, under which role, capability and state. `runRecordAction` reloads the record (org-scoped), checks that the requested status is offered right now, then calls the existing server action (`setQuoteStatus`, `updateDealStage`, `updateProjectStatus`, `setSubscriptionStatus`). Those actions keep their own validation, audit entries and revalidation.

**Row cap.** The invoice's verified-paid total is paged in 1,000-row pages until complete. The deal's linked-project check is a `head` count query.

**Accessibility.** The base-ui dialog provides the focus trap, Esc, and focus return to the element focused before opening. cmdk provides Arrow keys, Enter and `aria-activedescendant`. The dialog is named "Command palette" and has a description. The combobox is named "Search commands and records". Icons are `aria-hidden`. The trigger has `aria-keyshortcuts`.

## Files

- `lib/search/query.ts` and `query.test.ts` hold the search sources, LIKE escaping and the PostgREST `or` filter.
- `lib/search/commands.ts` and `commands.test.ts` build the nav and create commands, filtered by role.
- `lib/search/record-actions.ts` and `record-actions.test.ts` parse the record from the path and list the StatusBar actions.
- `lib/search/actions.ts` and `actions.test.ts` hold the `searchRecords`, `recordActions` and `runRecordAction` server actions.
- `components/command-palette/command-palette.tsx` is the client palette and its trigger button.
- `app/(app)/layout.tsx` gets one import and one mount line in the header.
- `components/ui/command.tsx` moves `CommandDialog`'s sr-only title and description inside `DialogContent`. This is outside the ownership list. Base-ui renders a title placed outside the popup in place, so "Command palette" sat as a hidden heading in the top bar on every page. The palette is the only `CommandDialog` user.
- `e2e/command-palette.spec.ts` is new.

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

## Open issues

- Record search and the record actions were not exercised against a real database. The coordinator's integration run of the e2e spec is the first real check. A manual check of "Mark sent" from the palette on a draft quote is worth doing.
- PostgREST treats `*` in an ilike value as `%`, so a `*` in a search acts as a wildcard. It is harmless, and the products list has the same behavior.
- Search includes archived products, with no marker.
- On a record page the Actions group appears a moment after the palette opens, once its server action returns.
