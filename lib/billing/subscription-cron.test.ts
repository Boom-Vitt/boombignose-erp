import { createClient } from "@supabase/supabase-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Database } from "@/lib/types/database"

const state = vi.hoisted(() => ({ client: null as unknown, generate: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => state.client }))
vi.mock("@/lib/billing/generate", () => ({ generateSubscriptionOccurrence: state.generate }))
import { POST } from "@/app/api/cron/subscriptions/route"

const orgId = "22222222-2222-4222-8222-222222222222"
const due = (id: string) => ({ id, org_id: orgId, next_run_date: "2026-07-02" })
const request = () => new Request("http://localhost/api/cron/subscriptions", { method: "POST", headers: { "X-Cron-Secret": "test-secret" } })

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret")
  state.generate.mockReset().mockResolvedValue("invoice")
})
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs() })

describe("subscription cron", () => {
  it("records a failed subscription and reason and continues with the next one", async () => {
    const audits: unknown[] = []
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.generate.mockRejectedValueOnce(new Error("Customer is archived"))
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false },
      global: { fetch: async (url, init) => {
        if (String(url).includes("/audit_log")) {
          await Promise.resolve()
          audits.push(JSON.parse(String(init?.body)))
          return new Response(null, { status: 201 })
        }
        return Response.json([due("failed-sub"), due("healthy-sub")])
      } },
    })
    const response = await POST(request())
    expect(response.status).toBe(503)
    expect(await response.json()).toMatchObject({ processed: 1, failed: 1 })
    expect(state.generate.mock.calls.map(call => call.slice(1))).toEqual([
      [orgId, "failed-sub", "2026-07-02"], [orgId, "healthy-sub", "2026-07-02"],
    ])
    expect(log).toHaveBeenCalledWith("subscription_generation_failed", expect.objectContaining({ subscriptionId: "failed-sub", orgId, reason: "Customer is archived", occurrence: "2026-07-02" }))
    expect(audits).toEqual([expect.objectContaining({ org_id: orgId, entity: "subscription", entity_id: "failed-sub", action: "generation_failed", meta: { reason: "Customer is archived", occurrence: "2026-07-02" } })])
  })

  it("processes due subscriptions beyond the API row cap", async () => {
    const rows = Array.from({ length: 1001 }, (_, i) => due(`sub-${i}`))
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false },
      global: { fetch: async url => {
        const query = new URL(String(url)).searchParams
        const offset = Number(query.get("offset") ?? 0)
        const limit = Number(query.get("limit") ?? 1000)
        return Response.json(rows.slice(offset, offset + limit))
      } },
    })
    const response = await POST(request())
    expect(await response.json()).toEqual({ ok: true, processed: 1001, failed: 0 })
    expect(state.generate).toHaveBeenCalledTimes(1001)
  })

  it("continues processing when recording a failure audit is unavailable", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined)
    state.generate.mockRejectedValueOnce(new Error("Customer is archived"))
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false },
      global: { fetch: async url => String(url).includes("/audit_log")
        ? Response.json({ message: "Audit storage unavailable", code: "P0001" }, { status: 500 })
        : Response.json([due("failed-sub"), due("healthy-sub")]) },
    })
    const response = await POST(request())
    expect(await response.json()).toMatchObject({ processed: 1, failed: 1 })
    expect(state.generate).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledWith("subscription_failure_audit_failed", expect.objectContaining({ subscriptionId: "failed-sub", auditReason: "Audit storage unavailable" }))
  })

  it("rejects unauthorized scans before accessing subscriptions", async () => {
    const response = await POST(new Request("http://localhost/api/cron/subscriptions", { method: "POST" }))
    expect(response.status).toBe(401)
    expect(state.generate).not.toHaveBeenCalled()
  })
})
