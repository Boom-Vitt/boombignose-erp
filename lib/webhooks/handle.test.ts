import { createClient } from "@supabase/supabase-js"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/lib/types/database"
const state = vi.hoisted(() => ({ client: null as unknown, requests: [] as unknown[], duplicate: false }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }))
import { POST as followup } from "@/app/api/webhooks/n8n/followup/route"
import { POST as overdue } from "@/app/api/webhooks/n8n/invoice-overdue/route"
import { POST as deadline } from "@/app/api/webhooks/n8n/project-deadline/route"

const orgId = "11111111-1111-4111-8111-111111111111"
const key = "22222222-2222-4222-8222-222222222222"
const eventId = "33333333-3333-4333-8333-333333333333"
function request(secret = "local-secret", body: unknown = { orgId, payload: { sourceId: "synthetic" } }, idempotencyKey = key) {
  return new Request("http://localhost/api/webhooks/n8n/followup", {
    method: "POST", headers: { "X-Webhook-Secret": secret, "Idempotency-Key": idempotencyKey, "Content-Type": "application/json" }, body: JSON.stringify(body),
  })
}
beforeEach(() => {
  vi.stubEnv("N8N_WEBHOOK_SECRET", "local-secret")
  state.requests = []
  state.duplicate = false
  state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      state.requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return Response.json({ eventId, duplicate: state.duplicate })
    } },
  })
})

describe("authenticated inbound event receipts", () => {
  it.each([["followup", followup], ["invoice-overdue", overdue], ["project-deadline", deadline]] as const)("persists %s before acknowledgement and acknowledges a durable duplicate", async (event, handler) => {
    const response = await handler(request())
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, event, eventId, duplicate: false })
    state.duplicate = true
    expect(await (await handler(request())).json()).toEqual({ ok: true, event, eventId, duplicate: true })
    expect(state.requests).toEqual(Array(2).fill({ url: "http://127.0.0.1:55501/rest/v1/rpc/accept_integration_event", body: { p_org_id: orgId, p_event_type: event, p_key: key, p_payload: { sourceId: "synthetic" } } }))
  })
  it("rejects unauthenticated input before any database command", async () => {
    expect((await followup(request("wrong-secret"))).status).toBe(401)
    expect(state.requests).toEqual([])
  })
  it("rejects missing identity, invalid tenants and malformed JSON instead of acknowledging", async () => {
    for (const input of [request("local-secret", {}, ""), request("local-secret", { orgId: "wrong", payload: {} }), new Request("http://localhost", { method: "POST", headers: { "X-Webhook-Secret": "local-secret", "Idempotency-Key": key }, body: "{" })]) {
      expect((await followup(input)).status).toBe(400)
    }
    expect(state.requests).toEqual([])
  })
  it("rejects non-object event payloads before a futile database retry", async () => {
    for (const payload of [null, [], "text", 101]) {
      expect((await followup(request("local-secret", { orgId, payload }))).status).toBe(400)
    }
    expect(state.requests).toEqual([])
  })
})
