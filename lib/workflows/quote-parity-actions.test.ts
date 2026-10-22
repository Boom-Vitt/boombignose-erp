import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  ctx: { orgId: "00000000-0000-4000-8000-000000000001", role: "owner" },
  rpc: vi.fn(), from: vi.fn(), capability: vi.fn(), rows: [] as Record<string, unknown>[],
  lastPosition: 8 as number | null, positionError: null as { message: string } | null,
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => state.ctx,
  requireCapability: state.capability,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: state.from, rpc: state.rpc }) }))
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: state.from, rpc: state.rpc }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`redirect:${path}`) } }))

import { addQuoteItem, cancelQuoteInvoice, convertQuoteToInvoice, createQuote, deleteQuoteItem, setQuoteStatus, updateQuote } from "@/app/(app)/quotes/actions"
import { addInvoiceItem } from "@/app/(app)/finance/invoice-items-actions"
import { portalAcceptQuote } from "@/ee/portal/actions"

const id = "00000000-0000-4000-8000-000000000002"
const key = "00000000-0000-4000-8000-000000000003"

beforeEach(() => {
  vi.clearAllMocks()
  state.ctx.role = "owner"
  state.rows = []
  state.lastPosition = 8
  state.positionError = null
  state.capability.mockImplementation((ctx: { role: string }, capability: string) => {
    if (ctx.role === "member" && capability === "quote:convert") throw new Error("Forbidden")
  })
  state.rpc.mockResolvedValue({ data: id, error: null })
  state.from.mockImplementation((table: string) => {
    let columns = ""
    const chain = {
      select: (value: string) => { columns = value; return chain },
      eq: () => chain, order: vi.fn(() => chain), limit: vi.fn(() => chain),
      insert: (row: Record<string, unknown>) => { state.rows.push(row); return chain },
      update: () => chain, delete: () => chain,
      single: async () => ({ data: { id, number: "QUO-2026-000123" }, error: null }),
      maybeSingle: async () => columns === "position" ? { data: state.lastPosition === null ? null : { position: state.lastPosition }, error: state.positionError } : { data: table === "org_settings" ? { vat_registered: false, vat_rate_bps: 0 } : { id, quote_id: id, status: "sent", valid_until: null }, error: null },
      then: (resolve: (value: unknown) => unknown) => resolve({ data: [], count: 2, error: null }),
    }
    return chain
  })
})

describe("quote app permissions", () => {
  it("cancels a draft through the scoped quantity-release command", async () => {
    expect(await cancelQuoteInvoice({ quoteId: id, invoiceId: key })).toEqual({})
    expect(state.rpc).toHaveBeenCalledWith("cancel_quote_invoice", { p_org_id: state.ctx.orgId, p_invoice_id: key })
    expect(state.capability).toHaveBeenCalledWith(state.ctx, "quote:convert")
  })
  it("rejects member cancellation before querying the database", async () => {
    state.ctx.role = "member"
    expect(await cancelQuoteInvoice({ quoteId: id, invoiceId: key })).toEqual({ error: "Only owners and admins can cancel quote invoices." })
    expect(state.rpc).not.toHaveBeenCalled()
  })
  it("surfaces cancellation refusal without pretending quantities were released", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Cancel the final draft invoice before its deposit" } })
    expect(await cancelQuoteInvoice({ quoteId: id, invoiceId: key })).toEqual({ error: "Cancel the final draft invoice before its deposit" })
  })
  it.each([
    ["update", () => updateQuote({ id, client_id: id, discountBaht: 0 })],
    ["delete line", () => deleteQuoteItem({ id })],
    ["status", () => setQuoteStatus({ id, status: "declined" })],
  ])("requires record:write to %s", async (_name, action) => {
    await action()
    expect(state.capability).toHaveBeenCalledWith(state.ctx, "record:write")
  })
  it("lets a member edit records but reserves acceptance for staff", async () => {
    state.ctx.role = "member"
    expect(await setQuoteStatus({ id, status: "accepted" })).toEqual({ error: "Only owners and admins can accept quotes." })
    expect(state.from).not.toHaveBeenCalled()
  })
})

describe("atomic quote numbering and append positions", () => {
  it("reserves quote numbers without scanning existing quotes", async () => {
    state.rpc.mockResolvedValue({ data: "QUO-2026-000123", error: null })
    await expect(createQuote({ client_id: id })).rejects.toThrow(`redirect:/quotes/${id}`)
    expect(state.rpc).toHaveBeenCalledWith("reserve_document_number", { p_org_id: state.ctx.orgId, p_kind: "quote", p_year: expect.any(Number) })
    expect(state.rows[0]?.number).toBe("QUO-2026-000123")
  })
  it("does not insert a quote if number reservation fails", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Counter unavailable" } })
    expect(await createQuote({ client_id: id })).toEqual({ error: "Counter unavailable" })
    expect(state.from).not.toHaveBeenCalled()
  })
  it.each([
    ["quote", () => addQuoteItem({ quote_id: id, description: "Service", quantity: 1, unitPriceBaht: 1 })],
    ["invoice", () => addInvoiceItem({ invoice_id: id, description: "Service", quantity: "1", unitPriceBaht: "1" })],
  ])("appends %s lines after the highest surviving position", async (_name, action) => {
    expect(await action()).toEqual({})
    expect(state.rows[0]?.position).toBe(9)
  })
  it("starts empty quote lines at position zero", async () => {
    state.lastPosition = null
    expect(await addQuoteItem({ quote_id: id, description: "Service", quantity: 1, unitPriceBaht: 1 })).toEqual({})
    expect(state.rows[0]?.position).toBe(0)
  })
  it("does not insert an invoice line after a failed position read", async () => {
    state.positionError = { message: "Position unavailable" }
    expect(await addInvoiceItem({ invoice_id: id, description: "Service", quantity: "1", unitPriceBaht: "1" })).toEqual({ error: "Position unavailable" })
    expect(state.rows).toEqual([])
  })
})

describe("partial quote invoice commands", () => {
  it("passes selected quantities to the atomic conversion command", async () => {
    const lines = [{ quote_item_id: id, quantity: "1.125" }]
    await expect(convertQuoteToInvoice({ id, key, lines })).rejects.toThrow(`redirect:/finance/invoices/${id}`)
    expect(state.rpc).toHaveBeenCalledWith("convert_accepted_quote", { p_org_id: state.ctx.orgId, p_quote_id: id, p_key: key, p_lines: [{ quote_item_id: id, quantity: 1.125 }] })
  })
  it.each([{ depositSatang: 12345 }, { depositBps: 2500 }])("passes a deposit request %j", async (deposit) => {
    await expect(convertQuoteToInvoice({ id, key, ...deposit })).rejects.toThrow(`redirect:/finance/invoices/${id}`)
    expect(state.rpc).toHaveBeenCalledWith("convert_accepted_quote", expect.objectContaining("depositSatang" in deposit ? { p_deposit_satang: 12345 } : { p_deposit_bps: 2500 }))
  })
  it.each([
    { depositSatang: 1, depositBps: 1 }, { depositBps: 10001 }, { depositSatang: 0 },
    { lines: [] }, { lines: [{ quote_item_id: id, quantity: "0.0001" }] },
    { lines: [{ quote_item_id: id, quantity: 1 }], depositBps: 100 },
    { lines: [{ quote_item_id: id, quantity: 1 }, { quote_item_id: id, quantity: 1 }] },
  ])("rejects invalid or ambiguous conversion inputs %j", async (input) => {
    expect(await convertQuoteToInvoice({ id, key, ...input })).toEqual({ error: "Invalid input" })
    expect(state.rpc).not.toHaveBeenCalled()
  })
})

describe("portal acceptance evidence", () => {
  it("uses one token-scoped command with the accepting identity", async () => {
    expect(await portalAcceptQuote({ token: "opaque", quoteId: id, name: " Alex Client ", email: "alex@example.com" })).toEqual({})
    expect(state.rpc).toHaveBeenCalledWith("accept_portal_quote", { p_token: "opaque", p_quote_id: id, p_name: "Alex Client", p_email: "alex@example.com" })
    expect(state.from).not.toHaveBeenCalled()
  })
  it.each([{ name: "", email: "a@example.com" }, { name: "Client", email: "invalid" }])("requires a valid accepting identity %j", async (identity) => {
    expect(await portalAcceptQuote({ token: "opaque", quoteId: id, ...identity })).toEqual({ error: "Invalid request" })
    expect(state.rpc).not.toHaveBeenCalled()
    expect(state.from).not.toHaveBeenCalled()
  })
  it("keeps database details out of public acceptance errors", async () => {
    state.rpc.mockResolvedValue({ data: null, error: { message: "Private database detail" } })
    expect(await portalAcceptQuote({ token: "opaque", quoteId: id, name: "Client", email: "client@example.com" })).toEqual({ error: "Could not accept this quote." })
  })
})
