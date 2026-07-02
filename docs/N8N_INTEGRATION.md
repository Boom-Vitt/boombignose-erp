# n8n Integration

The Company OS exposes inbound webhook endpoints that **n8n** (or Hermes, or any
scheduler) can call to drive reminders and alerts. V1 ships validated
**placeholders** — they authenticate and acknowledge; you wire the actual
messaging (LINE, email) in n8n.

## Endpoints

All are `POST` and require the shared secret header `X-Webhook-Secret`.

| Endpoint | Purpose |
|---|---|
| `POST /api/webhooks/n8n/followup` | Trigger follow-up reminders (deals/activities due today) |
| `POST /api/webhooks/n8n/invoice-overdue` | Trigger overdue-invoice reminders |
| `POST /api/webhooks/n8n/project-deadline` | Trigger project-deadline alerts |

Each also answers `GET` with a small health JSON. These routes are **public** at
the middleware level (no user session) — they are protected by the secret header,
not by auth cookies.

## Authentication

Set a long random secret in your environment:

```bash
# .env.local
N8N_WEBHOOK_SECRET=use-a-long-random-string
```

Send it from n8n as a header on every request:

```
X-Webhook-Secret: use-a-long-random-string
Content-Type: application/json
```

The handler validates it in constant time (`lib/webhooks/verify.ts`). A missing or
wrong secret returns `401 { "error": "unauthorized" }`.

## Example call

```bash
curl -X POST http://localhost:3000/api/webhooks/n8n/followup \
  -H "Content-Type: application/json" \
  -H "X-Webhook-Secret: $N8N_WEBHOOK_SECRET" \
  -d '{"orgSlug":"boombignose"}'
# → 200 { "ok": true, "event": "followup", ... }
```

## Wiring it in n8n

1. **Schedule** node (e.g. daily 09:00 Asia/Bangkok).
2. **HTTP Request** node → `POST` the endpoint with the `X-Webhook-Secret` header.
3. Branch on the response and send messages via the **LINE** / **email** nodes.

A typical flow: *Cron 09:00 → POST /followup → for each item → LINE push to the
deal owner.*

## Extending beyond placeholders

The V1 handlers do **not** read org data, because a webhook has no user session
and RLS would (correctly) return nothing. To have an endpoint return real rows
(e.g. "deals with a follow-up due today"), use a **service-role** Supabase client
**inside the route handler only**, and scope every query by `org_id` yourself
(derive the org from the secret or the payload). Keep the service-role key
server-side and never log it. Prefer giving each org its own secret if you expose
org-specific data.

## Future: outbound + Hermes

Later the app can also **call out** to n8n/Hermes when events happen (deal won,
invoice overdue) instead of being polled. The same secret pattern applies in
reverse (sign requests the app sends). LINE-based Hermes notifications are a
natural Pro-tier automation pack.

---

## Cron scan: `/api/cron/followups`

Unlike the `/api/webhooks/n8n/*` placeholders, this endpoint does **real work**.
A scheduler (n8n, Vercel Cron, or any timer) POSTs it on a cadence (e.g. daily
09:00 Asia/Bangkok). On each run it:

1. Scans **deals** with a `next_follow_up_date` on or before today (excluding
   `won`/`lost`) and **activities** that are not done with a `due_date` on or
   before today (Bangkok "today").
2. Upserts a `reminders` row per due item — **idempotently**, via the unique
   index `(org_id, entity, entity_id, due_date)`. Re-running the same day creates
   nothing new.
3. Queues one `outbound_events` row (`event_type: "followup.due"`) per
   **newly-created** reminder. This is the queue n8n / Hermes consumes.

### Contract

| | |
|---|---|
| **Method** | `POST` (also `GET`, identical behaviour, for health-check triggers) |
| **Auth header** | `X-Cron-Secret: <CRON_SECRET>` |
| **Body** | none required (ignored) |
| **Success** | `200 { "ok": true, "orgsScanned": n, "remindersUpserted": n, "eventsQueued": n }` |
| **Bad/missing secret** | `401 { "error": "unauthorized" }` |
| **Scan failure** | `500 { "error": "<message>" }` |

The secret is validated in constant time against `CRON_SECRET` (separate from
`N8N_WEBHOOK_SECRET`) using the same `lib/webhooks/verify.ts` helper. Set it in
your environment:

```bash
# .env.local
CRON_SECRET=use-a-long-random-string
```

> **Middleware:** `/api/cron` must be a public prefix at the middleware level
> (it carries no auth cookie) — see `PUBLIC_PREFIXES` in
> `lib/supabase/middleware.ts`. The route then enforces the secret itself, the
> same public-at-middleware + secret-in-handler model the webhook routes use.

### Example call

```bash
curl -X POST http://localhost:3000/api/cron/followups \
  -H "X-Cron-Secret: $CRON_SECRET"
# → 200 { "ok": true, "orgsScanned": 1, "remindersUpserted": 4, "eventsQueued": 4 }
# Re-run immediately → { ..., "remindersUpserted": 0, "eventsQueued": 0 }  (idempotent)
```

### Wiring in n8n

1. **Schedule** node → daily 09:00 Asia/Bangkok.
2. **HTTP Request** node → `POST /api/cron/followups` with the `X-Cron-Secret`
   header. This creates the reminders + queues the events.
3. (Separately) poll or subscribe to the `outbound_events` queue to deliver the
   messages — see below.

## Cron scan: `/api/cron/subscriptions`

Generates invoices from **due recurring subscriptions**. A scheduler (n8n, Vercel
Cron, or any timer) POSTs it on a cadence (suggested: **daily**, e.g. 09:00
Asia/Bangkok). On each run it:

1. Loads **active, auto-generating** subscriptions whose `next_run_date` is on or
   before today (Bangkok "today"), re-checking each with the `isDue` rule.
2. For each due subscription, builds a deterministic invoice number
   (`Name-YYYYMM` for the period) and **checks whether an invoice with that number
   already exists** for the org. If it does, it **skips** creation (no second
   invoice) but still advances the schedule.
3. Otherwise inserts one `invoices` row and advances `last_generated_on` /
   `next_run_date`.

### Idempotency (no double-billing)

The invoice number is deterministic per period and `invoices` has
`unique(org_id, number)`, so **re-running on the same day bills nothing new**:

- A pre-insert existence check skips subscriptions already billed for the period.
- As a belt-and-suspenders guard, a unique-constraint violation (`23505`) on
  insert is treated as a benign **skip**, not a failure.
- Either way the subscription's schedule is still advanced, so a duplicate run
  never leaves the cadence stuck re-scanning the same row.

The scan is resilient: a single failing subscription is logged and skipped; the
scan continues to the next row.

### Contract

| | |
|---|---|
| **Method** | `POST` (also `GET`, identical behaviour, for health-check triggers) |
| **Auth header** | `X-Cron-Secret: <CRON_SECRET>` |
| **Body** | none required (ignored) |
| **Success** | `200 { "ok": true, "generated": n, "skipped": n }` |
| **Bad/missing secret** | `401 { "error": "unauthorized" }` |
| **Scan failure** | `500 { "error": "<message>" }` |

`generated` counts newly-created invoices; `skipped` counts due subscriptions
whose period was already billed (the idempotency path). The secret is validated in
constant time against `CRON_SECRET` (the same variable the followups scan uses) via
`lib/webhooks/verify.ts`, and `/api/cron` is public at the middleware level — see
the note under the followups scan above.

### Example call

```bash
curl -X POST http://localhost:3000/api/cron/subscriptions \
  -H "X-Cron-Secret: $CRON_SECRET"
# → 200 { "ok": true, "generated": 3, "skipped": 0 }
# Re-run immediately → { "ok": true, "generated": 0, "skipped": 3 }  (idempotent)
```

### Wiring in n8n

1. **Schedule** node → daily (e.g. 09:00 Asia/Bangkok).
2. **HTTP Request** node → `POST /api/cron/subscriptions` with the `X-Cron-Secret`
   header. Safe to run more than once a day — extra runs generate nothing.

## Outbound queue contract (`outbound_events`)

The app records intent-to-notify in `outbound_events`; the delivery side
(n8n / Hermes) drains it. This decouples "a follow-up is due" from "a LINE/email
message was sent."

| Column | Meaning |
|---|---|
| `event_type` | What happened. V1 emits **`followup.due`**. Reserved for later: `deal.stalled`, `invoice.overdue`. |
| `payload` | JSON describing the event (see shape below). |
| `status` | `queued` → `delivered` \| `failed`. The app inserts as `queued`; the consumer flips it. |
| `attempts` | Delivery attempt counter the consumer increments. |
| `delivered_at` | Set by the consumer on success. |

### `followup.due` payload shape

```jsonc
{
  "reminderId": "uuid",      // the reminders row this event was raised for
  "entity": "deal",          // 'deal' | 'activity'
  "entityId": "uuid",        // the source deal/activity id
  "title": "Invoice Overdue Reminder System",
  "dueDate": "2026-06-30",   // YYYY-MM-DD (Bangkok)
  "summary": "Follow-up due: Invoice Overdue Reminder System"
}
```

### Draining the queue from n8n / Hermes

A typical consumer flow:

1. **Schedule** (e.g. every 5 min) → query `outbound_events` where
   `status = 'queued'` (via the Supabase node or a service-role HTTP call).
2. For each row, **send** the message — LINE push (Hermes), email, etc. — using
   the `payload`.
3. **Mark** the row: `status = 'delivered'`, `delivered_at = now()` on success,
   or `status = 'failed'` + increment `attempts` on error.

> **Future: Hermes (LINE).** Hermes is the planned LINE-based notifier. It slots
> in as the consumer in step 2: read `followup.due` (and later `invoice.overdue`)
> events, resolve the deal/activity owner's LINE binding, and push a card. No
> change to this contract is needed — the queue is the integration seam, so the
> producer (cron scan) and consumer (n8n/Hermes) evolve independently. LINE-based
> Hermes delivery is a natural Pro-tier automation pack.
