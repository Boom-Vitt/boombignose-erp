# W5-h branding handover: plain ERP naming and a professional README

Branch `odoo-w5h-branding` from `odoo-parity` at `e5022f1`. This track has no database. Commits are local and nothing was pushed.

## What changed

**The product is called BoomBigNose ERP everywhere a user sees it.** The owner asked for "ERP" instead of "Company OS", for positioning as an ERP for businesses of every size rather than for AI studios, for the elephant emoji to go, and for a README in the ERPNext and Odoo style. These user-facing strings changed:

- The app title and description in `app/layout.tsx`, the login, signup and invitation pages, and both blueprint page titles.
- The workspace label under the organization name in the sidebar, for both editions (`lib/edition/community.tsx`, `ee/workspaces/components/org-switcher.tsx`).
- The email footer in `lib/email/render.ts` and the RFQ email footer in `lib/purchasing/rfq.ts`. The reference draft from earlier today missed the RFQ footer because purchasing did not exist on its base.
- The report footer in `lib/documents/report.ts`, the blueprint drawing title, the blueprint sheet's Thai subtitle (`ระบบปฏิบัติการธุรกิจ` was the Thai form of "Company OS"), and the live screen in the warehouse 3D scene.
- The banner in `.github/brand/banner.svg`, the header comment in `.env.example`, and `site/index.html`.

**The README follows the ERPNext layout.** `README.md` is English and `README.th.md` is the same content in Thai, with a language switch at the top of each. The sections are banner, tagline, four badges, links, Motivation, Key Features by module, Under the Hood, Scope, Editions (Community against Pro), Development Setup, Production Setup, Learning and Community, Contributing, Security, License, and Logo and Trademark Policy. There are no screenshots, because `docs/images/` does not exist on this base. The reference draft's screenshots showed the older module set, so I did not copy them.

Every feature claim was checked against the code, not against older docs. A survey agent read the routes, `ee/`, the handovers and the migrations, and an independent reviewer then rechecked the claims. Things the README states on purpose:

- Customer credit notes are "in development". Only vendor credits from purchase returns exist on this base.
- VAT and withholding tax are document calculations, not a statutory tax system or e-Tax Invoice. This matches the app's own disclaimer on the invoice page.
- The Pro accounting connection is a "preview" that sends no data yet, because `ee/accounting/provider.ts` is a stub.
- There is no one-command install, and the production section lists the manual steps, including Supabase Auth URLs, custom SMTP and the Pro provisioning SQL.
- `pnpm e2e` needs the isolated stack in `docs/testing/erp-gates.md`.
- Local sign-up confirmation links follow `site_url` in `supabase/config.toml` (`http://127.0.0.1:3100`).

**SECURITY.md and issue templates.** `SECURITY.md` sends reports to GitHub Security Advisories, with a fallback contact through boombignose.org. `.github/ISSUE_TEMPLATE/` has a bug report with a module dropdown and an edition field, a feature request, and a `config.yml` that disables blank issues and links the private channels. `CONTRIBUTING.md` now points security reports at `SECURITY.md`.

**The showcase site.** `site/index.html` now has a "B" monogram instead of the elephant, and no emoji at all. The copy says ERP for businesses of every size. The feature grid covers the twelve current module areas, including purchasing, inventory, products and expenses. The old roadmap section became an Editions section (Community, Pro, on the roadmap). The scope note no longer says inventory, purchasing and tax are out of scope. The footer no longer says the software is proprietary, and the tech list names OpenRouter instead of the Anthropic SDK. The page has no horizontal scroll at 390px or 1280px (checked with Playwright screenshots).

**A guard test keeps the old name out.** `lib/branding.test.ts` scans the user-facing surfaces (`app`, `components`, `ee`, `hooks`, `lib`, `public`, `site`, `.github`, `proxy.ts`, both READMEs, `SECURITY.md`, `CONTRIBUTING.md`, `.env.example`). It fails on "Company OS" in any spacing, the elephant emoji, "AI studio", and the Thai forms. Paths resolve from the test file, and the test asserts that it scanned more than 100 files, so it cannot pass by scanning nothing.

## Files

- UI strings: `app/layout.tsx`, `app/login/page.tsx`, `app/signup/page.tsx`, `app/invite/[token]/page.tsx`, `app/(app)/blueprint/page.tsx`, `app/blueprint-preview/page.tsx`, `components/warehouse/office.ts`, `ee/workspaces/components/org-switcher.tsx`, `lib/edition/community.tsx`, `lib/blueprint/scene-data.ts`, `lib/documents/report.ts`, `lib/email/render.ts`, `lib/purchasing/rfq.ts`.
- New: `lib/branding.test.ts`, `README.th.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/{bug_report,feature_request,config}.yml`, this handover.
- Rewritten: `README.md`, `site/index.html`, `.github/brand/banner.svg`.
- Small edits: `CONTRIBUTING.md`, `.env.example` (header comment only).
- Untouched on purpose: `LICENSE`, `COMMERCIAL-LICENSE.md`, `NOTICE`, `TRADEMARK.md`, SQL migration comments, `docs/`, `.claude/agents/`, and the `package.json` name `boombignose-company-os`, which no user sees.

## SQL function ownership

None created or replaced. This track has no migration.

## Evidence

- The guard test failed before the fix. Its first run listed `site/index.html`, `.github/brand/banner.svg` and `README.md` as offenders. Restoring the old `lib/blueprint/scene-data.ts` turned it red again on the English and Thai patterns, and the fix turned it green. It also passes when run from another directory with `--root`.
- Gates on the final tree: `pnpm lint`, `pnpm typecheck`, `pnpm exec tsc --noEmit -p tsconfig.pro.json`, `pnpm test` (151 files, 1,193 tests), `pnpm build`, and `BBN_EDITION=pro pnpm build` (run before the review fixes, which touched no Pro code). No SQL suite or e2e run, because this track has no database.
- Independent review by a separate agent checked every README and site claim against the source. It ran `pnpm exec supabase --version` (2.120.0) and the unit tests for the touched files. Its findings were fixed, apart from the open issues below.

## Open issues

- **Private vulnerability reporting is off on GitHub.** `gh api repos/Boom-Vitt/boombignose-erp-harness-ai/private-vulnerability-reporting` returns `{"enabled":false}`, so the advisory link in `SECURITY.md` does not work until the owner enables it under Settings → Code security. The boombignose.org fallback covers the gap. I did not change repository settings.
- `docs/ROADMAP.md`, `docs/ODOO_COMPARISON.md` and `docs/ODOO_TODO.md` still describe the product as a Company OS without inventory or purchasing. The README no longer links the roadmap. Updating those docs is a separate task.
- Legal files linked from the README (`COMMERCIAL-LICENSE.md`, `NOTICE`) still say "Company OS". Changing them is the owner's decision.
- The demo seed still reads like an AI studio (organization "BoomBigNose AI", deals such as "Website Chatbot"), the warehouse 3D scene has a "Founder office", and the AI prompts mention a "busy founder". These are demo data and scene flavour, not product naming.
- The local sign-up flow on an empty database was not run, because this track has no database. The README's note about `site_url` comes from reading `supabase/config.toml` and `app/signup/actions.ts`.
- Branches W5-a to W5-g were unmerged when this was written. After they land, recheck the README's features, editions and the credit-note line.
