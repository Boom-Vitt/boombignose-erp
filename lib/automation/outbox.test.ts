import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"
import type { Database } from "@/lib/types/database"
import { deliverOutbox } from "./outbox"

const eventId = "11111111-1111-4111-8111-111111111111"
const orgId = "22222222-2222-4222-8222-222222222222"
const lease1 = "33333333-3333-4333-8333-333333333333"
const lease2 = "44444444-4444-4444-8444-444444444444"
const envelope = { id: eventId, org_id: orgId, event_type: "followup.due", payload: { title: "Call client" }, attempts: 1, lease_token: lease1 }

function database(handler: (name: string, args: Record<string, unknown>) => unknown) {
  return createClient<Database>("http://127.0.0.1:55501", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => Response.json(handler(String(url).split("/").pop()!, JSON.parse(String(init?.body)))) },
  })
}

describe("at-least-once outbox delivery", () => {
  it("starts every leased send together so later events do not wait through earlier timeouts", async () => {
    const client = database(name => name === "claim_outbound_events" ? [envelope, { ...envelope, id: lease2 }] : true)
    let releaseFirst: () => void = () => undefined
    const first = new Promise<void>(resolve => { releaseFirst = resolve })
    const sink: typeof fetch = async (_url, init) => {
      if (new Headers(init?.headers).get("Idempotency-Key") === eventId) await first
      else releaseFirst()
      return new Response(null, { status: 204 })
    }
    expect((await deliverOutbox(client, { url: "http://127.0.0.1:55599", secret: "test" }, sink)).delivered).toBe(2)
  }, 500)
  it("retries a response-lost send with the same stable event idempotency key", async () => {
    const acknowledgements: Record<string, unknown>[] = []
    let attempt = 0
    const client = database((name, args) => {
      if (name === "claim_outbound_events") return [{ ...envelope, attempts: ++attempt, lease_token: attempt === 1 ? lease1 : lease2 }]
      acknowledgements.push(args)
      return true
    })
    const keys: string[] = []
    const acceptedBodies: unknown[] = []
    const sink: typeof fetch = async (_url, init) => {
      keys.push(new Headers(init?.headers).get("Idempotency-Key")!)
      acceptedBodies.push(JSON.parse(String(init?.body)))
      if (keys.length === 1) throw new Error("Connection lost after receiver committed")
      return new Response(null, { status: 204 })
    }
    const config = { url: "http://127.0.0.1:55599/events", secret: "local-test-secret" }
    expect(await deliverOutbox(client, config, sink)).toEqual({ disabled: false, attempted: 1, delivered: 0, failed: 1, unacknowledged: 0 })
    expect(await deliverOutbox(client, config, sink)).toEqual({ disabled: false, attempted: 1, delivered: 1, failed: 0, unacknowledged: 0 })
    expect(keys).toEqual([eventId, eventId])
    expect(acceptedBodies).toEqual(Array(2).fill({ version: 1, eventId, orgId, type: "followup.due", payload: { title: "Call client" } }))
    expect(acknowledgements).toEqual([
      { p_event_id: eventId, p_lease_token: lease1, p_error: "Delivery failed" },
      { p_event_id: eventId, p_lease_token: lease2, p_error: null },
    ])
  })
  it("does not count an expired or superseded lease as delivered", async () => {
    const client = database(name => name === "claim_outbound_events" ? [envelope] : false)
    const sink: typeof fetch = async () => new Response(null, { status: 204 })
    expect(await deliverOutbox(client, { url: "https://configured.example/events", secret: "test" }, sink)).toEqual({ disabled: false, attempted: 1, delivered: 0, failed: 0, unacknowledged: 1 })
  })
  it("does not claim or send when no delivery destination is configured", async () => {
    const client = database(() => { throw new Error("Must not claim") })
    const sink: typeof fetch = async () => { throw new Error("Must not send") }
    expect(await deliverOutbox(client, undefined, sink)).toEqual({ disabled: true, attempted: 0, delivered: 0, failed: 0, unacknowledged: 0 })
  })
  it("persists HTTP failure without accepting a redirect as delivery", async () => {
    let persisted: unknown
    const client = database((name, args) => { if (name === "claim_outbound_events") return [envelope]; persisted = args; return true })
    const sink: typeof fetch = async (_url, init) => { expect(init?.redirect).toBe("error"); return new Response(null, { status: 503 }) }
    expect((await deliverOutbox(client, { url: "http://127.0.0.1:55599", secret: "test" }, sink)).failed).toBe(1)
    expect(persisted).toEqual({ p_event_id: eventId, p_lease_token: lease1, p_error: "HTTP 503" })
  })
})
