import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"

import type { Database } from "@/lib/types/database"

/** Display label only. Idempotency lives in the DB occurrence record. */
export function invoiceNumberFor(subscriptionId: string, occurrence: string): string {
  return `SUB-${subscriptionId}-${occurrence.replaceAll("-", "")}`
}

/** Invoice + occurrence claim + one schedule advancement + audit are atomic.
 * Retries must preserve the scheduled date, including after a lost response.
 */
export async function generateSubscriptionOccurrence(
  supabase: SupabaseClient<Database>, orgId: string, subscriptionId: string, occurrence: string
): Promise<string> {
  const { data, error } = await supabase.rpc("generate_subscription_occurrence", {
    p_org_id: orgId, p_subscription_id: subscriptionId, p_occurrence: occurrence,
  })
  if (error) throw new Error(error.message)
  const parsed = z.guid().safeParse(data)
  if (!parsed.success) throw new Error("Invalid subscription command result")
  return parsed.data
}
