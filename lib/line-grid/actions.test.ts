import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  ctx: { orgId: "b0000000-0000-4000-8000-000000000001", role: "owner" },
  rpc: vi.fn(),
  capability: vi.fn(),
  audit: vi.fn(),
  reload: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => state.ctx, requireCapability: state.capability }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: state.rpc }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: state.audit }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./queries", () => ({ gridRows: state.reload }))

import { saveDocumentLines } from "./actions"

const documentId = "70000000-0000-0000-0000-000000000001"
const line = { kind: "line" as const, id: "70000000-0000-0000-0000-000000000002", product_id: null, description: " Design ", quantity: "2.125", unit: "hour", unit_price_satang: 101, tax_rate_bps: 700 }
const note = { kind: "note" as const, id: "70000000-0000-0000-0000-000000000003", description: "Delivered on site" }
const serverRows = [{ kind: "line", id: line.id, productId: null, description: "Design", quantity: "2.125", unit: "hour", unitPrice: "1.01", taxRateBps: 700 }]

beforeEach(() => {
  vi.clearAllMocks()
  state.ctx.role = "owner"
  state.rpc.mockResolvedValue({ error: null })
  state.reload.mockResolvedValue(serverRows)
})

describe("saveDocumentLines", () => {
  it("sends every change in one atomic call and returns the rows the server now holds", async () => {
    const deleted = ["70000000-0000-0000-0000-000000000004"]
    expect(await saveDocumentLines({ document: "quote", documentId, rows: [line, note], deleted })).toEqual({ rows: serverRows })
    expect(state.rpc).toHaveBeenCalledWith("save_document_lines", { p_document: "quote", p_document_id: documentId, p_rows: [{ ...line, description: "Design" }, note], p_deleted: deleted })
    expect(state.reload).toHaveBeenCalledWith(expect.anything(), state.ctx.orgId, "quote", documentId)
    expect(state.audit).toHaveBeenCalledWith(state.ctx, expect.objectContaining({ entity: "quote", entityId: documentId, action: "lines_saved", meta: { lines: 1, sections: 1, removed: 1 } }))
  })

  it.each([
    ["quote", "record:write"],
    ["invoice", "payment:verify"],
    ["purchase_order", "purchase:manage"],
  ] as const)("checks the %s line capability before any database call", async (document, capability) => {
    state.capability.mockImplementationOnce(() => { throw new Error("forbidden") })
    expect(await saveDocumentLines({ document, documentId, rows: [line], deleted: [] })).toEqual({ error: "You cannot edit these lines." })
    expect(state.capability).toHaveBeenCalledWith(state.ctx, capability)
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it.each([
    ["a forged product id", { ...line, product_id: "forged" }],
    ["a quantity PostgreSQL would round", { ...line, quantity: "1.0001" }],
    ["a zero quantity", { ...line, quantity: "0" }],
    ["a fractional satang price", { ...line, unit_price_satang: 1.5 }],
    ["an unsafe line total", { ...line, quantity: "999999999", unit_price_satang: Number.MAX_SAFE_INTEGER }],
    ["a blank description", { ...line, description: "  " }],
    ["a forged row id", { ...line, id: "line-1" }],
  ])("rejects %s before any database call", async (_label, row) => {
    expect(await saveDocumentLines({ document: "invoice", documentId, rows: [row], deleted: [] })).toEqual({ error: "Some lines are invalid. Fix the highlighted cells and save again." })
    expect(state.rpc).not.toHaveBeenCalled()
  })

  it("surfaces the database guard's refusal without auditing or reloading", async () => {
    state.rpc.mockResolvedValue({ error: { message: "Agreement lines are frozen" } })
    expect(await saveDocumentLines({ document: "quote", documentId, rows: [line], deleted: [] })).toEqual({ error: "Agreement lines are frozen" })
    expect(state.audit).not.toHaveBeenCalled()
    expect(state.reload).not.toHaveBeenCalled()
  })

  it("reports a saved-but-unreloaded result as an error, so a retry converges", async () => {
    state.reload.mockRejectedValue(new Error("network"))
    expect(await saveDocumentLines({ document: "purchase_order", documentId, rows: [line], deleted: [] })).toEqual({ error: "Lines saved, but reloading them failed. Reload the page." })
  })
})
