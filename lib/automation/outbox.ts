import type { SupabaseClient } from "@supabase/supabase-js"
import { z } from "zod"
import type { Database } from "@/lib/types/database"

const Claim = z.object({
  id: z.uuid(), org_id: z.uuid(), event_type: z.string().min(1),
  payload: z.json(), attempts: z.number().int().positive(), lease_token: z.uuid(),
})
export type DeliveryConfig = { url: string; secret: string }
export type DeliveryResult = {
  disabled: boolean; attempted: number; delivered: number; failed: number; unacknowledged: number
}

/** DB leases and retry times are authoritative. A send can succeed while its
 * response/ack is lost, so consumers must deduplicate the stable event UUID.
 */
export async function deliverOutbox(
  supabase: SupabaseClient<Database>, config?: DeliveryConfig, send: typeof fetch = fetch
): Promise<DeliveryResult> {
  const result: DeliveryResult = { disabled: !config, attempted: 0, delivered: 0, failed: 0, unacknowledged: 0 }
  if (!config) return result
  const target = new URL(config.url)
  if (!config.secret || target.username || target.password || (target.protocol !== "https:" && !(target.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)))) {
    throw new Error("Invalid outbound delivery configuration")
  }
  const { data, error } = await supabase.rpc("claim_outbound_events", { p_limit: 10, p_lease_seconds: 120 })
  if (error) throw new Error(error.message)
  const events = z.array(Claim).safeParse(data)
  if (!events.success) throw new Error("Invalid outbox claim result")

  const attempts = await Promise.allSettled(events.data.map(async event => {
    result.attempted++
    let failure: string | null = null
    try {
      const response = await send(target, {
        method: "POST", redirect: "error", signal: AbortSignal.timeout(30_000),
        headers: { "Content-Type": "application/json", "X-Webhook-Secret": config.secret, "Idempotency-Key": event.id },
        body: JSON.stringify({ version: 1, eventId: event.id, orgId: event.org_id, type: event.event_type, payload: event.payload }),
      })
      if (!response.ok) failure = `HTTP ${response.status}`
      await response.body?.cancel()
    } catch {
      failure = "Delivery failed"
    }
    // Do not overwrite uncertain acknowledgements with a second error command.
    // An expired lease or transport loss is safely reclaimable from the DB.
    const { data: acknowledged, error: ackError } = await supabase.rpc("finish_outbound_event", {
      p_event_id: event.id, p_lease_token: event.lease_token,
      ...(failure === null ? {} : { p_error: failure }),
    })
    if (ackError) throw new Error("Outbox acknowledgement failed")
    if (acknowledged !== true) result.unacknowledged++
    else if (failure) result.failed++
    else result.delivered++
  }))
  if (attempts.some(attempt => attempt.status === "rejected")) throw new Error("Outbox acknowledgement failed")
  return result
}
