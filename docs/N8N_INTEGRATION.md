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
