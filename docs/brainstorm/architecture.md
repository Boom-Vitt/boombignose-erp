# Architecture — BoomBigNose Company OS

Implementation-ready architecture for the V1 AI-native operational layer. Six modules (CRM, Projects, Finance, Templates, Automation, Dashboard), built in parallel by a 3-person team on Next.js App Router + Supabase, with a DB-independent pure-function core.

## 1. Folder structure

```
boombignose-erp/
├── app/
│   ├── (auth)/                  # public: login, callback (no shell)
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (app)/                   # authed layout: sidebar + org guard
│   │   ├── layout.tsx           # getUser() gate + resolveOrg()
│   │   ├── crm/{page.tsx,actions.ts,components/}
│   │   ├── projects/{page.tsx,actions.ts,components/}
│   │   ├── finance/{page.tsx,actions.ts,components/}
│   │   ├── templates/{page.tsx,actions.ts,components/}
│   │   ├── automation/{page.tsx,actions.ts,components/}
│   │   └── dashboard/page.tsx   # reads-only, composes core selectors
│   └── api/webhooks/n8n/route.ts  # inbound, secret-gated (NOT a server action)
├── lib/
│   ├── core/                    # PURE, DB-free, 100% unit-tested
│   │   ├── finance.ts           # runway, MRR, revenue, unpaid, invoiceStatus
│   │   ├── pipeline.ts          # pipeline value
│   │   ├── projects.ts          # project profit
│   │   ├── webhook.ts           # validateWebhookSecret
│   │   └── money.ts             # satang types + formatTHB
│   ├── supabase/{server.ts,client.ts,middleware.ts}
│   ├── auth/org.ts              # resolveOrg(), requireRole()
│   └── types/database.ts        # GENERATED from Supabase schema
├── components/ui/               # shadcn primitives (shared)
├── components/nav.ts            # central route registry (all modules)
├── supabase/migrations/        # SQL: tables + RLS, one timestamped file each
├── middleware.ts               # session refresh on every request
└── tests/  (Vitest: lib/core/*; Playwright: e2e/)
```

Each module owns its route segment, one `actions.ts`, and a private `components/` dir. Cross-module imports are forbidden except through `lib/core`, `lib/auth`, `components/ui`, and `components/nav.ts`.

## 2. Module boundaries & the shared contract

Independence comes from **co-location**: a module is a folder. Two devs editing `crm/` and `finance/` never touch the same file, so parallel work produces no merge conflicts. Business logic lives in `lib/core` (pure), never inside a `page.tsx` or `actions.ts`, which keeps it testable and keeps juniors from re-implementing money math six times.

**LOCK THIS FIRST (the shared contract — nothing else starts until it merges):**

1. **DB schema + RLS** in `supabase/migrations` — every business table with `org_id uuid`, money as `bigint` satang.
2. **Generated DB types** (`lib/types/database.ts`) via `supabase gen types` — the single source of truth all modules import.
3. **Money helpers** (`lib/core/money.ts`) — `Satang` brand type + `formatTHB`; floats banned.
4. **Auth/org helpers** (`lib/auth/org.ts`) — `resolveOrg()`, `requireRole()`.
5. **UI primitives** (`components/ui`) — shadcn set, so modules share buttons/tables/forms.
6. **Nav / route registry** (`components/nav.ts`) — all six routes declared up front so the shell is stable while pages fill in.

Once these six exist, the modules are genuinely parallelizable.

## 3. Auth + RLS model

Supabase Auth issues the session; `@supabase/ssr`'s `createServerClient` reads/writes it through Next cookies using the **`getAll`/`setAll`** handlers (the older `get`/`set`/`remove` triplet is deprecated). `cookies()` is awaited in the App Router. `middleware.ts` calls the Supabase client on every request to refresh the session cookie.

In Server Components and Server Actions we authenticate with **`supabase.auth.getUser()`**, which revalidates the JWT against Supabase — never `getSession()`, which trusts the cookie without verification and is unsafe for gating. The `(app)/layout.tsx` redirects unauthenticated users to `/login`.

Tenancy is enforced at the database, not in app code. A `memberships(user_id, org_id, role)` table maps users to orgs. **Every business table has an RLS policy** of the shape:

```sql
using (org_id in (select org_id from memberships where user_id = auth.uid()))
```

So a leaked or wrong `org_id` returns zero rows rather than another tenant's data. `resolveOrg()` reads the user's membership to fix the active `org_id` for inserts and UI; reads stay correct even without it because RLS already filters. The service-role key bypasses RLS and is used **only** in seed scripts, never in a request path.

## 4. Data-access pattern

- **Reads:** Server Components query Supabase directly (RLS-scoped), then hand rows to `lib/core` selectors for any derived numbers (runway, MRR, project profit). The component does I/O; the core does math.
- **Mutations:** Server Actions in each module's `actions.ts`. Each action (a) Zod-validates input, (b) calls `requireRole()` if needed, (c) writes via the session Supabase client, (d) `revalidatePath()`. No business calculation happens here — it delegates to `lib/core`, keeping every formula unit-tested in isolation from the DB.

## 5. Integration design

**Inbound (now):** n8n posts to `app/api/webhooks/n8n/route.ts` — a Route Handler, deliberately **not** a Server Action. A session-less webhook cannot satisfy `memberships`-based RLS, and service-role is reserved for seeding, so we resolve the tension explicitly: the handler validates the `X-Webhook-Secret` header via `lib/core/webhook.ts`, maps the secret to its owning `org_id`, and performs only the narrow, server-validated writes the three flows need (followup, invoice-overdue, project-deadline). Secret check is a pure function, so it is fully unit-tested.

**Outbound / accounting (deferred):** FlowAccount/PEAK/Xero sync is explicitly out of V1. We keep finance numbers canonical in satang so a later adapter can push to those systems without reshaping our data. No outbound code ships now.

## 6. Ranked risks

1. **Seed data invisible under RLS (highest).** Service-role-seeded business rows won't appear to normal users unless the matching `org` and `memberships` rows are seeded too. *Mitigation:* seed script creates org + membership for the dev user first; add a smoke test that the demo user sees demo data through the session client.
2. **Version-sensitive SSR cookie handling.** Wrong cookie API silently breaks session refresh and logs users out. *Mitigation:* one canonical `lib/supabase/*` implementation using `getAll`/`setAll` + awaited `cookies()`; never hand-roll per module.
3. **Satang inconsistency across modules.** A float or baht value anywhere corrupts runway/MRR/profit. *Mitigation:* `Satang` brand type + `formatTHB` as the only money path; lint/review rule banning `number` money fields; core tests assert integer math.
4. **Webhook spoofing / wrong-org writes.** *Mitigation:* constant-time secret compare, secret→org map, reject on mismatch, log.
5. **Org-scope drift on new tables.** A table shipped without RLS leaks tenants. *Mitigation:* migration checklist requires `org_id` + policy; periodic audit query for tables lacking RLS.

## 7. Recommended build order

1. **Shared contract** (§2 items 1–6) — schema + RLS, generated types, money, auth/org, `components/ui`, nav.
2. **Auth shell** — login, callback, middleware, `(app)/layout.tsx` guard, seed script (org + membership + demo data).
3. **`lib/core` + Vitest** — all pure formulas and webhook validation, test-first.
4. **CRM** then **Finance** (exercise the satang + core paths end-to-end first).
5. **Projects**, **Templates**.
6. **Automation webhooks** (Route Handler + n8n flows).
7. **Dashboard** last — it only composes existing core selectors.
8. **Playwright** smoke pass: login, org scoping, demo-data visibility.
