# Automation integration and recovery

Automation requires the coordinator migration that supplies `enqueue_reminders`, `generate_subscription_occurrence`, `claim_outbound_events`, `finish_outbound_event` and `accept_integration_event`. There is no fallback to separate financial or queue writes. Database commands enforce tenant links and owner/admin authorization; cron/integration commands also permit the server service role. Service credentials stay server-side.

## Scheduler commands

Every cron request requires `X-Cron-Secret` matching `CRON_SECRET`; missing/wrong configuration fails closed. These routes are public at middleware so the scheduler can reach them without a browser session.

| Command | Result | Recovery |
| --- | --- | --- |
| POST /api/cron/followups | `{ok,orgsScanned,remindersUpserted,eventsQueued}` | One transaction per org. Reminder identity is org/entity/source/date. Repeating a scan creates no duplicate and repairs a legacy reminder missing its event. |
| POST /api/cron/subscriptions | `{ok,processed,failed}` | Each subscription invokes one atomic scheduled occurrence. Partial failures return 503 so monitoring can retry. `processed` includes durable retries; it is not a new-invoice count. |
| POST /api/cron/outbox | `{ok,disabled,attempted,delivered,failed,unacknowledged}` | Claims up to 10 due events with 120-second leases and sends concurrently with 30-second timeouts. Failures and expired leases remain retryable. Partial delivery/acknowledgement failures return 503. |

GET on followups/subscriptions remains a compatibility trigger with the same secret and mutations. Health checks should use the inbound webhook GET endpoints, which perform no work.

## Scheduled billing identity

Billing identity is `(org_id,subscription_id,scheduled_date)`, persisted independently of the display invoice number. The number is `SUB-<full subscription UUID>-YYYYMMDD`; subscription names and renames do not affect billing identity. Two weekly occurrences within one month and same-name subscriptions are separate.

The command locks the subscription, creates its invoice and occurrence result, advances `next_run_date` by one interval, and records trusted audit in one transaction. A delayed run bills the scheduled date, not the scan date. Each invocation processes one occurrence; repeated scans catch up every missed period without skipping. Weekly cadence adds seven days. Monthly/quarterly/yearly cadence clamps the original start day to the month's end and restores it when possible, including leap day.

The manual “Generate scheduled invoice” button saves the org/subscription/scheduled date in tab session storage before sending. A transport failure preserves that same date across reload or status refresh until an acknowledgement clears that matching request; loading the advanced next date would incorrectly bill another period. If retry state cannot be saved, generation fails closed. A pending retry is labelled with its date. Editing a billed cadence requires the database's correction policy. The occurrence creates a complete draft invoice with one line retaining the subscription amount and a due date 15 days after the scheduled occurrence. Staff issuance/document review is a separate workflow.

## Outbound delivery

Delivery is disabled unless both `N8N_OUTBOUND_URL` and `N8N_OUTBOUND_SECRET` are configured. HTTPS is required outside loopback test destinations. Redirects and credentials embedded in the URL are rejected. Do not enable real delivery during local tests or before separately authorized integration setup.

Each request uses `Content-Type: application/json`, `X-Webhook-Secret: <outbound secret>` and `Idempotency-Key: <stable event UUID>`:

```json
{
  "version": 1,
  "eventId": "stable event UUID",
  "orgId": "organization UUID",
  "type": "followup.due",
  "payload": {
    "reminderId": "reminder UUID",
    "entity": "deal",
    "entityId": "source UUID",
    "title": "Follow up",
    "dueDate": "2026-10-13",
    "summary": "Follow-up due: Follow up"
  }
}
```

The receiver must durably deduplicate the event UUID before side effects. Delivery is at least once: a crash after the receiver accepts a message but before the app receives/records its acknowledgement can resend the same event. There is no exactly-once external-delivery guarantee.

The DB claims eligible queued/failed events, increments attempts, and assigns a fresh lease token. Acknowledgement must present the current nonexpired token. Success marks delivered; failure records a bounded error and schedules exponential backoff. Expired claims are reclaimable; a stale acknowledgement cannot certify a newer lease. Do not directly update queue status from n8n or a browser.

## Inbound event receipts

POST `/api/webhooks/n8n/followup`, `/invoice-overdue` and `/project-deadline` require `X-Webhook-Secret` matching `N8N_WEBHOOK_SECRET`, plus `Idempotency-Key: <UUID>`. Body:

```json
{ "orgId": "organization UUID", "payload": { "sourceId": "synthetic-example" } }
```

The body must be valid JSON, its `payload` must be an object, and the body may be no larger than 16 KiB. The handler persists a receipt before acknowledging `{ok:true,event,eventId,duplicate}`. Same org/event/key and equal JSON returns the durable receipt; a changed request conflicts (409). Missing secret returns 401; invalid identity/body returns 400; storage failure returns 503. GET returns only endpoint health.

These endpoints acknowledge authenticated integration receipts. They do not settle invoices, mark payments paid, modify overdue status, or send customer messages. The global secret represents a trusted server integration across orgs; it must never be distributed to tenant browsers or customer integrations. Tenant-specific integration credentials and accountant/document readiness remain separate release gates.

## Local acceptance evidence

Use synthetic tenants and a local sink. Prove concurrent duplicate commands, weekly/month-end/leap boundaries, reminder/event rollback and orphan repair, lease expiry/reclaim, stale acknowledgements, same-key response-loss retries, and unauthorized/replayed webhook rejection. Unit adapter tests prove request shape and retry keys; they do not substitute for direct API/database tests or actual pilot workflow acceptance.
