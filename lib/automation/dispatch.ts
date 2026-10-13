import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/types/database"
import type { ReminderSpec } from "./rules"

const Result = z.object({
  remindersUpserted: z.number().int().nonnegative().safe(),
  eventsQueued: z.number().int().nonnegative().safe(),
})
export type DispatchResult = z.infer<typeof Result>

/** DB checks roles/source tenancy and commits reminders + outbox together.
 * Repeating the command also repairs a legacy reminder with no matching event.
 */
export async function dispatchReminders(
  supabase: SupabaseClient<Database>, orgId: string, specs: ReminderSpec[]
): Promise<DispatchResult> {
  if (!specs.length) return { remindersUpserted: 0, eventsQueued: 0 }
  const { data, error } = await supabase.rpc("enqueue_reminders", {
    p_org_id: orgId, p_specs: specs,
  })
  if (error) throw new Error(`dispatchReminders: ${error.message}`)
  const parsed = Result.safeParse(data)
  if (!parsed.success) throw new Error("Invalid reminder command result")
  return parsed.data
}
