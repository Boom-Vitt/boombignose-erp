import { beforeEach, describe, expect, it, vi } from "vitest"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { can } from "@/lib/permissions"

const state = vi.hoisted(() => ({ role: "owner" as "owner" | "member", client: null as unknown, calls: [] as { url: string; body: unknown }[], loseResponse: false, taxReads: false, productWht: 100 as number | null }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ orgId: "22222222-2222-4222-8222-222222222222", userId: "owner", role: state.role }),
  requireCapability: (ctx: { role: "owner" | "member" }, cap: Parameters<typeof can>[1]) => { if (!can(ctx.role, cap)) throw new Error("Denied") },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }))
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`Redirect ${url}`) } }))
vi.mock("@/lib/audit", () => ({ writeAudit: async () => undefined }))
import { generateInvoiceNow, createSubscription, updateSubscription, setSubscriptionStatus, deleteSubscription } from "@/app/(app)/finance/subscription-actions"

const subId = "11111111-1111-4111-8111-111111111111"
const seedSubId = "80000000-0000-0000-0000-000000000001"
const seedClientId = "c0000000-0000-0000-0000-000000000001"
const seedProjectId = "e0000000-0000-0000-0000-000000000001"
const plainInput = { id: subId, name: "Retainer", client_id: "33333333-3333-4333-8333-333333333333", amountBaht: 100, interval: "monthly" as const }
const input = { ...plainInput, tax_rate_bps: 700, wht_rate_bps: 300, prices_include_vat: false }

beforeEach(() => {
  state.role = "owner"
  state.calls = []
  state.loseResponse = false
  state.taxReads = false
  state.productWht = 100
  state.client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      state.calls.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) })
      if (state.taxReads) {
        if (String(url).includes("/org_settings")) return Response.json({ vat_registered: true, vat_rate_bps: 700, wht_rate_bps: 300, prices_include_vat: true })
        if (String(url).includes("/products")) return Response.json({ id: seedProjectId, tax_rate_bps: 0, wht_rate_bps: state.productWht, unit: "month" })
        if (String(init?.method) === "POST") return Response.json({ id: subId })
      }
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
  it("rejects unsafe money before a subscription write", async () => {
    expect(await updateSubscription({ ...input, amountBaht: Number.MAX_SAFE_INTEGER })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
  it("resets the pre-billing anchor through an atomic schedule command with metadata", async () => {
    expect(await updateSubscription({ ...input, start_date: "2026-11-01" })).toEqual({})
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rpc/update_subscription_schedule"), body: {
      p_org_id: "22222222-2222-4222-8222-222222222222", p_subscription_id: subId,
      p_start_date: "2026-11-01", p_changes: expect.objectContaining({ name: "Retainer", amount_satang: 10000, tax_rate_bps: 700, wht_rate_bps: 300 }),
    } }])
  })
  it("resumes without back-billing unless explicitly requested", async () => {
    await setSubscriptionStatus({ id: subId, status: "active" })
    await setSubscriptionStatus({ id: subId, status: "active", bill_missed_periods: true })
    expect(state.calls.map(call => call.body)).toEqual([false, true].map(billMissed => ({
      p_org_id: "22222222-2222-4222-8222-222222222222", p_subscription_id: subId,
      p_start_date: null, p_status: "active", p_bill_missed_periods: billMissed,
    })))
  })
  it("preserves stored tax choices when an update omits them", async () => {
    await updateSubscription(plainInput)
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rpc/update_subscription_schedule"), body: expect.objectContaining({
      p_start_date: null,
      p_changes: expect.any(Object),
    }) }])
    const changes = (state.calls[0].body as { p_changes: object }).p_changes
    for (const key of ["tax_rate_bps", "wht_rate_bps", "prices_include_vat", "product_id"]) expect(changes).not.toHaveProperty(key)
  })
  it("defaults new subscriptions to organization VAT, WHT and price inclusion", async () => {
    state.taxReads = true
    await expect(createSubscription(plainInput)).rejects.toThrow("Redirect")
    expect(state.calls.at(-1)?.body).toMatchObject({ tax_rate_bps: 700, wht_rate_bps: 300, prices_include_vat: true })
  })
  it("takes a selected product's tax and WHT overrides without losing zero rates", async () => {
    state.taxReads = true
    await expect(createSubscription({ ...plainInput, product_id: seedProjectId })).rejects.toThrow("Redirect")
    expect(state.calls.at(-1)?.body).toMatchObject({ product_id: seedProjectId, tax_rate_bps: 0, wht_rate_bps: 100, unit: "month" })
  })
  it("falls back to organization WHT when the product has no override", async () => {
    state.taxReads = true
    state.productWht = null
    await expect(createSubscription({ ...plainInput, product_id: seedProjectId })).rejects.toThrow("Redirect")
    expect(state.calls.at(-1)?.body).toMatchObject({ tax_rate_bps: 0, wht_rate_bps: 300 })
    for (const call of state.calls.filter(call => call.url.includes("/products") || call.url.includes("/org_settings"))) expect(call.url).toContain("org_id=eq.22222222-2222-4222-8222-222222222222")
  })
  it("keeps explicit zero tax and withholding choices over product defaults", async () => {
    state.taxReads = true
    await expect(createSubscription({ ...input, product_id: seedProjectId, tax_rate_bps: 0, wht_rate_bps: 0 })).rejects.toThrow("Redirect")
    expect(state.calls.at(-1)?.body).toMatchObject({ tax_rate_bps: 0, wht_rate_bps: 0 })
  })
  it("rejects invalid withholding rates before any write", async () => {
    expect(await createSubscription({ ...input, wht_rate_bps: 400 })).toEqual({ error: "Invalid input" })
    expect(state.calls).toEqual([])
  })
})

describe("seed-shaped ids", () => {
  it("accepts a seed project id in the optional project select", async () => {
    await createSubscription({ ...input, project_id: seedProjectId })
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rest/v1/subscriptions"), body: expect.objectContaining({ project_id: seedProjectId }) }])
  })
  it("accepts a seed client id on create", async () => {
    await createSubscription({ ...input, client_id: seedClientId })
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rest/v1/subscriptions"), body: expect.objectContaining({ client_id: seedClientId }) }])
  })
  it("accepts seed subscription and client ids on update", async () => {
    await updateSubscription({ ...input, id: seedSubId, client_id: seedClientId })
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rpc/update_subscription_schedule"), body: expect.objectContaining({ p_subscription_id: seedSubId, p_changes: expect.objectContaining({ client_id: seedClientId }) }) }])
  })
  it("accepts a seed subscription id on status change", async () => {
    await setSubscriptionStatus({ id: seedSubId, status: "paused" })
    expect(state.calls).toEqual([{ url: expect.stringContaining("/rpc/update_subscription_schedule"), body: expect.objectContaining({ p_subscription_id: seedSubId, p_status: "paused" }) }])
  })
  it("accepts a seed subscription id on delete", async () => {
    await deleteSubscription({ id: seedSubId })
    expect(state.calls).toEqual([{ url: expect.stringContaining(`id=eq.${seedSubId}`), body: null }])
  })
  it("accepts a seed subscription id on manual generation", async () => {
    expect(await generateInvoiceNow({ id: seedSubId, occurrence: "2026-07-02" })).toEqual({})
    expect(state.calls).toEqual([expect.objectContaining({ body: expect.objectContaining({ p_subscription_id: seedSubId }) })])
  })
})
