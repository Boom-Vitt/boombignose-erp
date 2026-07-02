/**
 * SERVER-ONLY. Persists reminder specs and queues one outbound event per
 * NEWLY-created reminder. Idempotent: re-running the scan upserts against the
 * `reminders_dedup_idx` unique index (org_id, entity, entity_id, due_date) with
 * `ignoreDuplicates`, so duplicates are skipped at the DB level and `.select()`
 * returns ONLY the rows actually inserted. That returned set is exactly what we
 * fan out to `outbound_events` — a second run produces zero new reminders and
 * zero events.
 *
 * Accepts any Supabase client (service-role from the cron route, or an
 * RLS-scoped session client). Callers must already have authorized the work and
 * pass a trusted `orgId`.
 */

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/lib/types/database"
import type { ReminderSpec } from "@/lib/automation/rules"

type Client = SupabaseClient<Database>

export type DispatchResult = {
  remindersUpserted: number
  eventsQueued: number
}

export async function dispatchReminders(
  supabase: Client,
  orgId: string,
  specs: ReminderSpec[]
): Promise<DispatchResult> {
  if (specs.length === 0) {
    return { remindersUpserted: 0, eventsQueued: 0 }
  }

  const rows = specs.map((spec) => ({
    org_id: orgId,
    entity: spec.entity,
    entity_id: spec.entityId,
    title: spec.title,
    due_date: spec.dueDate,
    // channel/status/meta fall back to table defaults ('inapp'/'pending'/{}).
    meta: { source: "cron.followups", entity: spec.entity, entity_id: spec.entityId },
  }))

  // ignoreDuplicates → ON CONFLICT DO NOTHING; .select() then returns only the
  // freshly-inserted reminders (duplicates are NOT returned).
  const { data: inserted, error } = await supabase
    .from("reminders")
    .upsert(rows, {
      onConflict: "org_id,entity,entity_id,due_date",
      ignoreDuplicates: true,
    })
    .select("id, entity, entity_id, title, due_date")

  if (error) {
    throw new Error(`dispatchReminders: failed to upsert reminders: ${error.message}`)
  }

  const newReminders = inserted ?? []
  if (newReminders.length === 0) {
    return { remindersUpserted: 0, eventsQueued: 0 }
  }

  const events = newReminders.map((reminder) => ({
    org_id: orgId,
    event_type: "followup.due",
    payload: {
      reminderId: reminder.id,
      entity: reminder.entity,
      entityId: reminder.entity_id,
      title: reminder.title,
      dueDate: reminder.due_date,
      summary: `Follow-up due: ${reminder.title}`,
    },
    // status/attempts fall back to table defaults ('queued'/0).
  }))

  const { data: queued, error: eventError } = await supabase
    .from("outbound_events")
    .insert(events)
    .select("id")

  if (eventError) {
    // Reminders are already persisted (and deduped), so a failure here is
    // recoverable on the next scan only for events. Surface it so the route can
    // log/return a partial result rather than silently dropping the queue write.
    throw new Error(
      `dispatchReminders: reminders upserted but outbound_events insert failed: ${eventError.message}`
    )
  }

  return {
    remindersUpserted: newReminders.length,
    eventsQueued: queued?.length ?? 0,
  }
}
