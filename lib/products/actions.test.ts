import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  ctx: { orgId: "b5000000-0000-4000-8000-000000000001", role: "owner" },
  from: vi.fn(), insert: vi.fn(), update: vi.fn(), eq: vi.fn(), select: vi.fn(),
  result: { data: { id: "b5000000-0000-4000-8000-000000000002", name: "Training", sku: null, description: null, unit: "day", list_price_satang: 101 }, error: null } as { data: object | null; error: { code?: string; message: string } | null },
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => state.ctx,
  requireCapability: (ctx: { role: string }, capability: string) => {
    if (capability !== "product:manage" || ctx.role === "member") throw new Error("Forbidden")
  },
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: state.from }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

import { saveProduct, setProductActive } from "./actions"
import { writeAudit } from "@/lib/audit"

const id = "b5000000-0000-4000-8000-000000000002"
const input = { name: " Training ", sku: " TRAIN ", description: " Training day ", type: "service" as const, unit: "day", listPriceBaht: "1.01", costBaht: "0.50", taxRateBps: 700, isStockable: false }

beforeEach(() => {
  vi.clearAllMocks()
  state.ctx.role = "owner"
  state.result = { data: { id, name: "Training", sku: null, description: null, unit: "day", list_price_satang: 101 }, error: null }
  const chain = { insert: state.insert, update: state.update, eq: state.eq, select: state.select, maybeSingle: async () => state.result }
  for (const fn of [state.from, state.insert, state.update, state.eq, state.select]) fn.mockReturnValue(chain)
})

describe("catalog server actions", () => {
  it("writes normalized fields with exact integer satang and records the creation", async () => {
    expect(await saveProduct(input)).toMatchObject({ product: { id } })
    expect(state.insert).toHaveBeenCalledWith({ org_id: state.ctx.orgId, name: "Training", sku: "TRAIN", description: "Training day", type: "service", unit: "day", list_price_satang: 101, cost_satang: 50, tax_rate_bps: 700, is_stockable: false })
    expect(writeAudit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ entity: "product", entityId: id, action: "created" }))
  })

  it("turns optional blank SKU and description into null", async () => {
    await saveProduct({ ...input, sku: " ", description: " " })
    expect(state.insert).toHaveBeenCalledWith(expect.objectContaining({ sku: null, description: null }))
  })

  it("scopes updates to the active org and product", async () => {
    await saveProduct(input, id)
    expect(state.eq.mock.calls).toEqual([["org_id", state.ctx.orgId], ["id", id]])
    expect(state.insert).not.toHaveBeenCalled()
  })

  it("archives a referenced product using an update and audits it", async () => {
    expect(await setProductActive(id, false)).toEqual({})
    expect(state.update).toHaveBeenCalledWith({ active: false })
    expect(state.eq.mock.calls).toEqual([["org_id", state.ctx.orgId], ["id", id]])
    expect(writeAudit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ action: "archived" }))
  })

  it("rejects ordinary members before any database calls", async () => {
    state.ctx.role = "member"
    expect(await saveProduct(input)).toHaveProperty("error")
    expect(await setProductActive(id, false)).toHaveProperty("error")
    expect(state.from).not.toHaveBeenCalled()
  })

  it("rejects invalid IDs and overprecise prices before writes", async () => {
    expect(await saveProduct(input, "forged")).toHaveProperty("error")
    expect(await saveProduct({ ...input, listPriceBaht: "1.001" })).toHaveProperty("error")
    expect(await setProductActive("forged", false)).toHaveProperty("error")
    expect(state.from).not.toHaveBeenCalled()
  })

  it("explains duplicate SKU failures without writing an audit", async () => {
    state.result = { data: null, error: { code: "23505", message: "duplicate key" } }
    expect(await saveProduct(input)).toEqual({ error: "This SKU is already used in your workspace." })
    expect(writeAudit).not.toHaveBeenCalled()
  })

  it("reports missing products instead of claiming an update succeeded", async () => {
    state.result = { data: null, error: null }
    expect(await saveProduct(input, id)).toEqual({ error: "Product not found" })
    expect(await setProductActive(id, true)).toEqual({ error: "Product not found" })
    expect(writeAudit).not.toHaveBeenCalled()
  })
})
