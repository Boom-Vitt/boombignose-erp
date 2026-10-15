import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { can } from "@/lib/permissions"

const state = vi.hoisted(() => ({ role: "owner" as "owner" | "member", client: null as unknown, calls: [] as unknown[], loseResponse: false }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "22222222-2222-4222-8222-222222222222", userId: "owner", role: state.role }),
  requireCapability: (ctx: { role: "owner" | "member" }, cap: Parameters<typeof can>[1]) => { if (!can(ctx.role, cap)) throw new Error("Denied") },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("@/lib/audit", () => ({ writeAudit: async () => undefined }))
import { generateInvoiceNow, createSubscription, updateSubscription, setSubscriptionStatus } from "@/app/(app)/finance/subscription-actions"

const subId = "11111111-1111-4111-8111-111111111111"
const input = { id: subId, name: "Retainer", client_id: "33333333-3333-4333-8333-333333333333", amountBaht: 100, interval: "monthly" as const }

beforeEach(() => {
  state.role = "owner"
  state.calls = []
  state.loseResponse = false
  state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      state.calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) })
      if (!String(url).includes("/rpc/")) return Response.json({ message: "Unexpected direct billing write", code: "P0001" }, { status: 400 })
      if (state.loseResponse) { state.loseResponse = false; throw new Error("Connection lost after commit") }
      return Response.json("44444444-4444-4444-8444-444444444444")
    } },
  })
})

describe("subscription action boundaries", () => {
  it("retries the requested scheduled occurrence after a committed response is lost", async () => {
    const request = { id: subId, occurrence: "2026-07-02" }
    state.loseResponse = true
    expect((await generateInvoiceNow(request)).error).toContain("Connection lost after commit")
    expect(await generateInvoiceNow(request)).toEqual({})
    expect(state.calls).toEqual(Array(2).fill({ url: "http://127.0.0.1:55501/rest/v1/rpc/generate_subscription_occurrence", body: { p_org_id: "22222222-2222-4222-8222-222222222222", p_subscription_id: subId, p_occurrence: "2026-07-02" } }))
  })
  it("requires owners/admins for every subscription mutation", async () => {
    state.role = "member"
    for (const result of [await createSubscription(input), await updateSubscription(input), await setSubscriptionStatus({ id: subId, status: "paused" })]) {
      expect(result.error).toContain("owners and admins")
    }
    expect(state.calls).toEqual([])
  })
  it("rejects a missing occurrence rather than silently selecting a new period", async () => {
    expect(await generateInvoiceNow({ id: subId })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
  it("rejects invalid dates before a subscription write", async () => {
    expect(await createSubscription({ ...input, start_date: "2026-02-30" })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
  it("clearing notes on update writes null instead of leaving the old notes", async () => {
    await updateSubscription({ ...input, notes: "" })
    expect(state.calls).toHaveLength(1)
    expect((state.calls[0] as { body: { notes: unknown } }).body.notes).toBeNull()
  })
  it("rejects unsafe money before a subscription write", async () => {
    expect(await updateSubscription({ ...input, amountBaht: Number.MAX_SAFE_INTEGER })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
  it("refuses a start-date change that would leave the schedule on the old anchor", async () => {
    const reads: string[] = []
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url, init) => {
        if ((init?.method ?? "GET") !== "GET") return Response.json({ message: "Unexpected write" }, { status: 400 })
        reads.push(String(url))
        return Response.json([{ start_date: "2026-07-01" }])
      } },
    })
    expect((await updateSubscription({ ...input, start_date: "2026-08-01" })).error).toContain("start date can't be changed")
    expect(reads[0]).toContain("org_id=eq.22222222-2222-4222-8222-222222222222")
  })
  it("does not update when the current start date cannot be read", async () => {
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (_url, init) => {
        if ((init?.method ?? "GET") !== "GET") throw new Error("Unexpected write")
        return Response.json({ message: "read failed" }, { status: 500 })
      } },
    })
    expect(await updateSubscription({ ...input, start_date: "2026-08-01" })).toEqual({ error: "read failed" })
  })
})

describe("subscription amount and project checks", () => {
  it("rejects a zero amount and sub-satang decimals instead of rounding them", async () => {
    expect(await createSubscription({ ...input, amountBaht: 0 })).toEqual({ error: "Invalid input" })
    expect(await createSubscription({ ...input, amountBaht: "100.005" })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
  it("refuses a project that belongs to another client, which billing would never accept", async () => {
    const writes: string[] = []
    state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url, init) => {
        if ((init?.method ?? "GET") !== "GET") { writes.push(String(url)); return Response.json({}) }
        return Response.json([{ client_id: "55555555-5555-4555-8555-555555555555" }])
      } },
    })
    const project_id = "66666666-6666-4666-8666-666666666666"
    expect((await createSubscription({ ...input, project_id })).error).toContain("belong to the selected client")
    expect((await updateSubscription({ ...input, project_id })).error).toContain("belong to the selected client")
    expect(writes).toEqual([])
  })
})
