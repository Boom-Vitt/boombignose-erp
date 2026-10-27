# BoomBigNose Company OS — System Inventory (source of truth for the Rust port)

> **Parked (2026-10-27).** This inventory fed the Rust port plan, which is parked. It is a snapshot of `main` at `ae0f68e` and does not describe the current tree. The active desktop notes are in `docs/bumik/`.

Snapshot of `main` @ `ae0f68e` (2026-10-09). Extracted from the code, not the docs.
Size: ~24k lines TS (`app/` + `lib/`), 8 SQL migrations, 26 Vitest files / 232 tests, Playwright e2e.

Companion plan: [`docs/superpowers/plans/2026-10-09-rust-port.md`](../superpowers/plans/2026-10-09-rust-port.md).

---

## 1. Data model (Postgres, schema `public`)

### Conventions
- `id uuid PK default gen_random_uuid()`; `org_id uuid NOT NULL → organizations ON DELETE CASCADE` on every business table.
- `created_at` / `updated_at timestamptz NOT NULL default now()`; `BEFORE UPDATE` trigger `set_updated_at()` on every table with `updated_at`.
- **Money = `bigint` satang** (`*_satang`, 1 THB = 100). Currency always THB.
- User references (`owner`, `assignee`, `user_id`, `created_by`, `invited_by`, `accepted_by`, `actor_id`) → `auth.users(id)`, mostly `ON DELETE SET NULL`.
- Only CHECK constraint in the schema: `time_entries.minutes >= 0`.

Migrations: M1 `init_schema` · M2 `rls_policies` · M3 `settings` · M4 `v2` · M5 `v2_ai_accounting` · M6 `v3_sales_docs` · M7 `v3_invitations` · M8 `v3_client_portal`.

### Tables (29)

| Group | Table | Key columns / constraints |
|---|---|---|
| Org/auth | `organizations` (M1) | `name`, `slug UNIQUE`; no `org_id` |
| | `profiles` (M1) | `id PK → auth.users CASCADE`, `full_name`, `avatar_url`, `locale default 'th'` |
| | `memberships` (M1) | `user_id → auth.users CASCADE`, `role role_enum default 'member'`, **UNIQUE(user_id, org_id)** |
| | `org_settings` (M3) | `org_id UNIQUE`, `cash_balance_satang default 0`, `monthly_burn_satang` (null ⇒ compute from costs) |
| | `invitations` (M7) | `email`, `role`, `token UNIQUE`, `status invitation_status default 'pending'`, `invited_by`, `accepted_by`, `expires_at`, **UNIQUE(org_id, email)** |
| CRM | `clients` (M1, M8) | `name`, `industry`, `source`, `notes`, `owner`, `portal_enabled bool default false`, `portal_token text UNIQUE` |
| | `contacts` | `client_id → clients CASCADE`, `name`, `email`, `phone`, `role` |
| | `deals` | `client_id → clients CASCADE`, `title`, `stage deal_stage default 'lead'`, `value_satang`, `currency char(3) 'THB'`, `expected_close_date`, `next_follow_up_date`, `source`, `notes`, `owner` |
| | `activities` | `client_id`, `deal_id` (both nullable, CASCADE), `type activity_type default 'note'`, `due_date`, `done`, `body`, `owner` |
| Projects | `projects` | `deal_id`, `client_id` (SET NULL), `name`, `status project_status`, `deadline`, `budget_satang`, `owner` |
| | `project_tasks` | `project_id CASCADE`, `title`, `status task_status`, `assignee`, `due_date`, `done` |
| | `milestones` | `project_id CASCADE`, `title`, `done`, `due_date` |
| | `time_entries` (M6) | `project_id CASCADE`, `task_id SET NULL`, `user_id`, `work_date date default current_date`, `minutes int CHECK >= 0`, `billable default true`, `rate_satang` (per hour) |
| Finance | `invoices` | `client_id CASCADE`, `project_id SET NULL`, `number`, `status invoice_status 'draft'`, `issue_date`, `due_date`, `amount_satang`, `is_recurring`, `recurring_interval`, `notes`, **UNIQUE(org_id, number)** |
| | `payments` | `invoice_id CASCADE`, `amount_satang`, `paid_at timestamptz`, `method payment_method 'transfer'`, `notes` |
| | `costs` | `project_id SET NULL`, `category cost_category 'other'`, `amount_satang`, `incurred_on date`, `vendor`, `notes` |
| | `quotes` (M6) | `client_id`, `project_id`, `number`, `status quote_status 'draft'`, `issue_date`, `valid_until`, `subtotal_satang`, `discount_satang`, `total_satang`, `converted_invoice_id → invoices`, `owner`, **UNIQUE(org_id, number)** |
| | `quote_items` / `invoice_items` (M6) | parent FK CASCADE, `description`, `quantity numeric(12,3) default 1`, `unit_price_satang`, `amount_satang` (app-computed), `position` |
| | `subscriptions` (M6) | `client_id`, `project_id`, `name`, `amount_satang`, `interval recurring_interval 'monthly'`, `status subscription_status 'active'`, `start_date`, `next_run_date NOT NULL`, `last_generated_on`, `auto_generate default true`, **UNIQUE(org_id, name)** |
| Templates | `template_categories` | `name`, `slug`, UNIQUE(org_id, slug) |
| | `automation_templates` | `category_id`, `name`, `description`, `internal_value_satang`, `price_satang`, `reusable_notes`, `implementation_checklist jsonb '[]'`, `tags text[]` (GIN) |
| Platform | `audit_log` (M4) | append-only; `actor_id`, `actor_email`, `entity`, `entity_id`, `action`, `summary`, `meta jsonb`; idx (org_id, created_at desc) |
| | `saved_views` (M4) | `user_id`, `module`, `name`, `config jsonb` |
| | `reminders` (M4) | `entity`, `entity_id`, `title`, `due_date`, `channel reminder_channel 'inapp'`, `status reminder_status 'pending'`, `meta`, `sent_at`; **UNIQUE INDEX (org_id, entity, entity_id, due_date)** (cron idempotency) |
| | `outbound_events` (M4) | `event_type`, `payload jsonb`, `status outbound_status 'queued'`, `attempts`, `delivered_at` — queue with **no consumer** |
| | `ai_outputs` (M5) | `entity`, `entity_id`, `kind ai_output_kind`, `model`, `content`, `created_by` |
| | `accounting_connections` (M5) | `provider`, `status`, `config jsonb` (non-secret), **UNIQUE(org_id)** |
| | `accounting_sync_map` (M5) | `provider`, `local_entity`, `local_id`, `external_id`, `status`, `last_error`, `last_synced_at`, UNIQUE(org_id, provider, local_entity, local_id) |

### Enums (19)
- `role_enum` owner · admin · member
- `deal_stage` lead · contacted · discovery · proposal · negotiation · won · lost
- `project_status` not_started · in_progress · review · delivered · support · paused · cancelled
- `invoice_status` draft · sent · partially_paid · paid · overdue · cancelled
- `quote_status` draft · sent · accepted · declined · expired · converted
- `task_status` todo · in_progress · done
- `activity_type` note · call · email · meeting · follow_up
- `payment_method` transfer · cash · card · promptpay · cheque · other
- `recurring_interval` weekly · monthly · quarterly · yearly
- `cost_category` software · contractor · infra · marketing · salary · other
- `subscription_status` active · paused · cancelled
- `invitation_status` pending · accepted · revoked · expired
- `reminder_status` pending · sent · cancelled; `reminder_channel` line · email · inapp
- `outbound_status` queued · delivered · failed
- `ai_output_kind` deal_summary · followup_draft · meeting_intake
- `accounting_provider` flowaccount · peak · xero; `accounting_conn_status` disconnected · connected · error; `accounting_sync_status` pending · synced · error

### Functions, triggers, RLS
- `set_updated_at()` trigger fn.
- `private.is_org_member(org)` and `private.shares_org(user)` — SECURITY DEFINER, `search_path=''`, keyed on `auth.uid()`.
- `handle_new_user()` trigger on `auth.users` insert → creates `profiles` row.
- No views, no RPCs, no storage buckets, no realtime, no edge functions.
- RLS ENABLE+FORCE on all tables. Pattern: `FOR ALL TO authenticated USING/WITH CHECK (is_org_member(org_id))`. `memberships`: select own only. `organizations`: select only (no update ⇒ org rename silently no-ops). `profiles`: select own/shared-org, update own. `audit_log`: select+insert only.
- RLS checks **membership only, never role**; roles are enforced in app code.

### Seed (`supabase/seed.sql`)
3 users (1 owner, 2 members; bcrypt via `crypt()`), 1 org (`a000…0001`), settings, 5 clients, 6 contacts, 8 deals, 5 activities, 4 projects + tasks + milestones, 6 invoices, 2 payments, 6 costs, 3 categories, 5 templates, 2 quotes + items, invoice items, 4 time entries, 2 subscriptions. `set time zone 'Asia/Bangkok'`. **Fresh-reset only:** rows with fixed IDs use `ON CONFLICT`, but contacts and other rows without fixed IDs duplicate on re-run.

---

## 2. Auth & tenancy

- **Provider:** Supabase email/password only. No OAuth/MFA/SSO. JWT 1h + rotating refresh token in cookies, refreshed on every request by `proxy.ts`.
- **Password policy** (`lib/auth/password.ts`): ≥10 chars (JS `.length` = UTF-16 units), ≥1 lowercase, ≥1 uppercase, ≥1 digit; returns a list of human messages.
- **Signup** → `auth.signUp` with confirm link `{APP_URL}/auth/confirm` (PKCE code or `token_hash`). Creates profile only — **no org** (see defects).
- **Public paths** (no session): `/` (redirects to `/dashboard`), `/login`, `/signup`, `/auth/*`, `/api/webhooks/*`, `/api/cron/*`, `/portal/*`. Everything else → `/login?redirect=<path>`.
- **Active org:** cookie `active_org` (httpOnly, lax, 1 year) if user is a member, else oldest membership. Context = `{userId, email, orgId, orgName, role}`.
- **Invitations:** owner/admin invite `admin|member` (never owner); token = 32 hex; ~30-day expiry; upsert on (org, email) resets token. **No email sent** — link copied from UI. Accept requires login + case-insensitive email match → insert membership, mark accepted, set `active_org`.
- **Capabilities** (`lib/permissions.ts`): `settings:manage`, `team:manage`, `accounting:manage`, `client:delete`, `deal:delete`, `template:manage`, `quote:convert`, `quote:delete`, `invoice:delete`, `cost:delete`, `subscription:manage`, `audit:view` — **all = owner + admin**; member has none (but can create/update every business entity).
- **Audit:** `writeAudit()` best-effort insert after a successful mutation (errors only logged). Entities: client, cost, deal, invitation, invoice, payment, quote, settings, subscription, time_entry. Summaries embed `formatTHBWhole` amounts (e.g. quote conversion). Actions: created, updated, deleted, stage_changed, status_changed, payment_recorded, converted, emailed, invited, revoked, invoice_generated, item_added, item_deleted, time_logged, portal_enabled, portal_disabled, portal_token_regenerated. Not written from portal, cron, invite acceptance, or meeting intake (intake only caches to `ai_outputs` with entity `meeting`).

---

## 3. Business rules (`lib/`)

Timezone: **Asia/Bangkok** (UTC+7, no DST) for "today" and month boundaries. Dates are `yyyy-MM-dd`.

| Area | Rule |
|---|---|
| Money | `bahtToSatang = Math.round(b*100)`. `formatTHB` = Intl th-TH THB: `฿1,234.56`, negatives `-฿1,234.56`. Server-side renderers use only `formatTHB`. |
| Dates | `todayISO`/`monthKey` in Bangkok; `isPastDue(due, today) = due < today` (null ⇒ false); `daysUntil` whole days. |
| Invoice status (derived on read, never written back) | draft/cancelled unchanged → `amount>0 && paid>=amount` ⇒ paid → past due ⇒ overdue (even if partly paid) → `paid>0` ⇒ partially_paid → else stored status. `outstanding = max(0, amount−paid)`. |
| `recordPayment` (written) | after insert, re-sums payments; draft/cancelled unchanged; else `amount > 0 && totalPaid ≥ amount` ⇒ `paid`, else `totalPaid > 0` ⇒ `partially_paid`, else stored status kept. |
| Line items | `amount = Math.round(qty × unit)` (0 if non-finite); subtotal prefers stored `amount_satang`; `total = max(0, subtotal − max(0, discount))`; discount is absolute satang. Quote totals recomputed after every item change; items locked once quote `converted` / invoice `paid`. Invoice `amount_satang` recomputed from items only when ≥1 item. |
| Numbering | `nextDocumentNumber(prefix, existing, year)`: max of `^PREFIX-YEAR-(\d+)$` over trimmed numbers + 1, padded to ≥3 digits (`999 → 1000`). `INV`, `QUO`, Bangkok year. Manual numbers accepted. Recurring: `{SubscriptionName}-YYYYMM`. Converted quote: `INV-{quoteNumber}`. Uniqueness only via DB constraint. |
| Quote → invoice | owner/admin; refuse if already converted; invoice `draft`, amount = quote total, items copied, quote → `converted` + link. (Currently 3 separate writes, not a transaction.) `setQuoteStatus` accepts any value (UI offers draft→sent, sent→accepted/declined). |
| Finance metrics | revenue/costs per Bangkok month; MRR factors weekly 52/12, monthly 1, quarterly 1/3, yearly 1/12 — float sum, **one** `Math.round` at end. Dashboard MRR = active subscriptions. `unpaidTotal/Count` over stored status ∉ {draft, cancelled, paid}. `netBurn = costs − revenue`; `runway = cash / netBurn` (null if netBurn ≤ 0). Burn override `monthly_burn_satang` used whenever not null (even 0). |
| Pipeline | open = lead…negotiation; probability lead .1, contacted .2, discovery .3, proposal .5, negotiation .7, won 1, lost 0; weighted value rounded once. |
| Projects | revenue = invoices ∉ {draft, cancelled} (invoiced, not paid); cost = all costs; margin% = profit/revenue×100 (0 if no revenue). |
| Timesheets | minutes stored; `entryValue = round(m/60 × rate)` if billable & rate, rounded **per entry**; utilisation = billable/total minutes. |
| Reports | pivot client×month (keys sorted by UTF-16 code units) with totals; hours by project (sorted by `localeCompare`); hours shown `toFixed(2)`. |
| Recurring billing | `addInterval` clamps month-end (Jan 31 → Feb 28 → Mar 28, drift kept); `nextRunAfter` skips missed periods (≤1000 steps); due = active && auto_generate && next_run ≤ today. Generated invoice: `sent`, recurring, issue today, no due date. **Cron:** duplicate period (or `23505`) ⇒ skip but still advance. **Generate-now:** duplicate ⇒ error `An invoice for this period already exists`, schedule unchanged. TS date math runs in the host TZ (identical on UTC+ hosts like Bangkok; a UTC− host shifts month-end results) — Rust uses pure calendar dates. |
| Follow-ups | due = deals not won/lost with `next_follow_up_date ≤ today` + activities not done with `due_date ≤ today`; deals first, then activities; type-based fallback titles. Cron upserts `reminders` (ignore dups) and enqueues `followup.due` outbound events only for new reminders. |
| Webhook auth | constant-time compare of `X-Webhook-Secret` / `X-Cron-Secret` against env; empty ⇒ reject; 401 `{error:"unauthorized"}`. n8n endpoints are echo placeholders. |
| CSV | UTF-8 BOM, CRLF, RFC 4180 quoting, numbers raw (`String(n)`), formula guard (`= + - @ \t \r` ⇒ `'` prefix, before quoting). Money exported in baht. |
| Documents | `renderDocumentHtml` (Invoice/Quotation) and `renderReportHtml` → standalone HTML, browser print-to-PDF. English labels, HTML-escaped, discount line only if > 0 (`−฿…` U+2212). Footer: not a legal tax invoice. |
| Email | Resend `POST https://api.resend.com/emails`, never throws (`not_configured` / `error` / ok). Subjects `Invoice {n}` / `Quote {n}`; sends to client's first contact with an email; link to PDF route. |
| AI | Anthropic Messages, model `ANTHROPIC_MODEL` (default in code `claude-opus-4-8`), deal summary (≤120 words), follow-up draft (friendly/formal/brief), meeting intake (summary + `Action items:` bullets parsed by `parseActionItems`). Replies in Thai when context is Thai. Cached in `ai_outputs`. Missing key ⇒ `{notConfigured:true}`. |
| Accounting | FlowAccount/PEAK/Xero **stub** (fake id, no network); `invoiceToExternalPayload` maps to `{reference, customerName, issueDate, dueDate, currency:"THB", totalBaht, status}`. |
| Tax | **No VAT / WHT / e-Tax / tax-ID fields anywhere** — deliberately delegated to the accounting tool. |

UI-only helpers that stay in TypeScript (not ported): `calendar/month.ts`, `audit/format.ts`, `formatTHBCompact`, `utils.ts`. (`formatTHBWhole` is also used in audit summaries, so it is ported.)

---

## 4. Feature surface

| Module | Screens | Mutations |
|---|---|---|
| Dashboard | 10 KPI cards, follow-ups due today, needs-attention (overdue invoices / follow-ups) | — |
| Clients | list (`?q`), detail (contacts, deals, timeline, portal card), form | create/update/delete client, add/delete contact, enable/disable portal, regenerate token |
| Deals | stage columns (`?stage&q`, saved views, CSV), detail, form | create/update/delete, change stage, add activity, toggle done, AI summary, AI follow-up draft |
| Quotes | list, detail (items, status, email, PDF), form | create/update/delete, add/delete item, set status, convert to invoice, email |
| Projects | grouped by status, detail (P&L, tasks, milestones, hours) | create/update, set status, add/toggle task, add/toggle milestone |
| Timesheets | month stats, log form, recent entries | log time (hours→minutes), delete entry |
| Finance | invoices + costs tabs (`?status`, saved views, CSV), invoice detail, subscriptions list/detail | create/update invoice, add/delete item, record payment, accounting sync, email, create/delete cost, subscription CRUD + status + generate-now |
| Reports | 6-month revenue pivot + hours by project, print view | — |
| Calendar | month grid of activities, invoice due dates, project deadlines | — |
| Templates | library by category, detail, form | create category, create/update/delete template |
| Intake | paste meeting notes → AI summary + action items | AI call only |
| Automation | pending reminders, recent outbound events | — |
| Activity | last 100 audit rows (`audit:view`) | — |
| Settings | workspace form, team, invitations, accounting connection | update settings, invite, revoke, connect/disconnect accounting, saved views |
| Portal (public, token) | client's quotes, invoices (+items, outstanding), projects | accept quote (sent→accepted), **mark invoice paid** (inserts full payment) |
| Auth | login, signup, confirm, sign out, invite accept, org switcher | — |
| API | `/api/cron/{followups,subscriptions}` (`X-Cron-Secret`), `/api/webhooks/n8n/{followup,invoice-overdue,project-deadline}` (`X-Webhook-Secret`, placeholders) | — |

UI facts that matter: server-rendered shadcn tables (no client sort/paging), URL-param filters, react-hook-form + Zod, sonner toasts, English UI, light mode only, no charts, no command palette, no drag-and-drop.

### Environment variables
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (runtime: cron, portal, invite), `N8N_WEBHOOK_SECRET`, `CRON_SECRET`, `NEXT_PUBLIC_APP_URL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`, `RESEND_API_KEY`, `EMAIL_FROM`, `PLAYWRIGHT_BASE_URL`.

---

## 5. Known defects and gaps — port decision

| # | Finding | Decision |
|---|---|---|
| D1 | Page queries rely on RLS only, so a user in 2 orgs sees **both orgs' rows mixed** (dashboard numbers too). | **FIX** — every query scoped to the active org (DB policy on `app.org_id`). |
| D2 | Signup creates no org ⇒ new users hit a `/login` ↔ `/dashboard` redirect loop. | **FIX** — signup creates org + owner membership (invite-accept path skips it). |
| D3 | RLS ignores roles and the browser holds the anon key ⇒ a member can delete via PostgREST. | **FIX by design** — no direct DB access from browser; capabilities enforced in Rust. |
| D4 | Child rows can reference another org's parent by UUID. | **FIX** — composite FKs `(parent_id, org_id)`. |
| D5 | `saved_views` readable/editable by any org member. | **FIX** — scope to `user_id`. |
| D6 | `audit_log` insert does not pin `actor_id`. | **FIX** — server sets actor; policy checks it. |
| D7 | Org rename silently no-ops (no UPDATE policy). | **FIX** |
| D8 | Emailed PDF links require login ⇒ clients can't open them. | **FIX** — HMAC-signed, expiring public document links. |
| D9 | `/login?redirect=` not validated (open redirect). | **FIX** — allow only same-origin relative paths. |
| D10 | Quote→invoice conversion and auto-numbering are non-transactional / race-prone. | **FIX** — single transaction; retry on `23505`. |
| D11 | Dashboard `billableHoursThisMonth` sums all minutes incl. non-billable. | **FIX** (rename or filter — decide in Phase 4). |
| D12 | Portal "Mark paid" lets the client record a full payment with no review. | **DECIDE** — default keep behaviour + write an audit row. |
| D13 | `outbound_events` has no dispatcher; n8n endpoints are placeholders; accounting is a stub. | **KEEP** as-is (out of port scope). |
| D14 | `SUPABASE_SERVICE_ROLE_KEY` documented as seed-only but used at runtime. | Gone with Supabase. |

---

## 6. JavaScript behaviours the Rust code must reproduce

1. `Math.round` rounds .5 toward +∞ (`-2.5 → -2`); Rust `f64::round` rounds away from zero. Use `js_round`.
2. Float order of operations: MRR, weighted pipeline, report billable value round **once** at the end; timesheet values round **per entry**.
3. `String(n)` number printing in CSV / quantities; `toFixed(2)` for hours (`0.125 → "0.13"`); `toLocaleString("en-US")` in AI prompts.
4. Two sort orders: UTF-16 code-unit (`pivot`) vs ICU `localeCompare` (`hoursByProject`).
5. JS `trim()` strips U+FEFF; Rust `str::trim` does not. Use `js_trim`.
6. String length = UTF-16 code units (password policy).
7. Intl THB formatting: `฿` prefix, `-฿` for negatives, `,` grouping.
