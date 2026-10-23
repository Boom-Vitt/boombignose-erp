import { beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ rpc: vi.fn(), plan: vi.fn() }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: state.rpc, from: () => {
  const query = { select: () => query, eq: () => query, order: () => query, range: async () => ({ data: [{ org_id: "org" }], error: null }) }
  return query
} }) }))
vi.mock("@/lib/inventory/replenishment", () => ({ readReplenishmentPlan: state.plan }))
import { GET, POST } from "@/app/api/cron/replenishment/route"
const request = (query = "", method = "POST", secret = "test-cron-secret") => new Request(`http://localhost/api/cron/replenishment${query}`, { method, headers: { "X-Cron-Secret": secret } })
beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-cron-secret")
  state.rpc.mockReset().mockResolvedValue({ data: "po", error: null })
  state.plan.mockReset().mockResolvedValue([{ vendor_id: "vendor", product_name: "Widget", order_quantity: 3, expected_date: "2026-10-30" }])
})
it("rejects missing or wrong cron secrets before scanning", async () => {
  expect((await POST(request("", "POST", "wrong"))).status).toBe(401)
  expect(state.rpc).not.toHaveBeenCalled()
})
it("defaults to a dry run and keeps GET read-only even with the execution query", async () => {
  for (const response of [await POST(request()), await GET(request("?dry_run=false", "GET"))]) {
    expect(await response.json()).toMatchObject({ dryRun: true, processed: 0, preview: [{ orgId: "org" }] })
  }
  expect(state.rpc.mock.calls.every(([name]) => name === "replenishment_plan")).toBe(true)
})
it("creates one draft per planned vendor only on explicit execution", async () => {
  const response = await POST(request("?dry_run=false"))
  expect(await response.json()).toMatchObject({ dryRun: false, processed: 1, failed: 0 })
  expect(state.rpc).toHaveBeenCalledWith("create_replenishment_rfq", { p_org_id: "org", p_vendor_id: "vendor" })
})
it("reports partial failures and treats a concurrent completed plan as skipped", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "No products require replenishment" } })
  expect(await (await POST(request("?dry_run=false"))).json()).toMatchObject({ skipped: 1, failed: 0 })
  state.plan.mockRejectedValue(new Error("unavailable"))
  expect((await POST(request("?dry_run=false"))).status).toBe(503)
})
