import { beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  ctx: { orgId: "00000000-0000-4000-8000-000000000001", role: "owner" },
  rpc: vi.fn(),
  from: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => fixture.ctx,
  requireCapability: (ctx: { role: string }) => {
    if (ctx.role === "member") throw new Error("Forbidden")
  },
}))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: fixture.rpc, from: fixture.from }),
}))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
}))

import { convertQuoteToInvoice, setQuoteStatus, createQuote, addQuoteItem, updateQuote } from "@/app/(app)/quotes/actions"
import { createProject } from "@/app/(app)/projects/actions"

const quoteId = "00000000-0000-4000-8000-000000000002"
const key = "00000000-0000-4000-8000-000000000003"
const invoiceId = "00000000-0000-4000-8000-000000000004"

beforeEach(() => {
  vi.clearAllMocks()
  fixture.from.mockReset()
  fixture.rpc.mockReset()
  fixture.ctx.role = "owner"
})

describe("quote conversion command", () => {
  it("converts once through the atomic command and follows its durable result", async () => {
    fixture.rpc.mockResolvedValue({ data: invoiceId, error: null })
    await expect(convertQuoteToInvoice({ id: quoteId, key })).rejects.toThrow(
      `redirect:/finance/invoices/${invoiceId}`
    )
    expect(fixture.rpc).toHaveBeenCalledWith("convert_accepted_quote", {
      p_org_id: fixture.ctx.orgId, p_quote_id: quoteId, p_key: key,
    })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it("keeps the caller key unchanged on retries", async () => {
    fixture.rpc.mockResolvedValue({ data: invoiceId, error: null })
    for (let attempt = 0; attempt < 2; attempt++) {
      await expect(convertQuoteToInvoice({ id: quoteId, key })).rejects.toThrow(
        `redirect:/finance/invoices/${invoiceId}`
      )
    }
    expect(fixture.rpc.mock.calls.map((call) => call[1].p_key)).toEqual([key, key])
  })

  it("returns command errors without follow-up writes", async () => {
    fixture.rpc.mockResolvedValue({ data: null, error: { message: "Quote expired" } })
    expect(await convertQuoteToInvoice({ id: quoteId, key })).toEqual({ error: "Quote expired" })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it("blocks ordinary members before any database call", async () => {
    fixture.ctx.role = "member"
    expect(await convertQuoteToInvoice({ id: quoteId, key })).toEqual({
      error: "Only owners and admins can convert quotes.",
    })
    expect(fixture.rpc).not.toHaveBeenCalled()
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it("rejects invalid quote IDs and missing command keys", async () => {
    expect(await convertQuoteToInvoice({ id: "forged", key })).toEqual({ error: "Invalid input" })
    expect(await convertQuoteToInvoice({ id: quoteId, key: "" })).toEqual({ error: "Invalid input" })
    expect(fixture.rpc).not.toHaveBeenCalled()
    expect(fixture.from).not.toHaveBeenCalled()
  })
})

describe("quote lifecycle action", () => {
  it("cannot manufacture a converted status without conversion", async () => {
    // @ts-expect-error Deliberately forged public action input.
    expect(await setQuoteStatus({ id: quoteId, status: "converted" })).toEqual({ error: "Invalid input" })
    expect(fixture.from).not.toHaveBeenCalled()
  })
  it("rejects editing accepted quote lines before any insert", async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { status: "accepted" }, error: null }) }
    fixture.from.mockReturnValue(chain)
    expect(await addQuoteItem({ quote_id: quoteId, description: "Extra scope", quantity: 1, unitPriceBaht: 1 })).toEqual({ error: "This quote is locked" })
    expect(fixture.from).toHaveBeenCalledTimes(1)
  })
  it("rejects editing an accepted quote header", async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { status: "accepted" }, error: null }) }
    fixture.from.mockReturnValue(chain)
    expect(await updateQuote({ id: quoteId, client_id: quoteId, discountBaht: 0 })).toEqual({ error: "This quote is locked" })
    expect(fixture.from).toHaveBeenCalledTimes(1)
  })
  it("rejects skipped status changes", async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: { status: "draft", valid_until: null }, error: null }) }
    fixture.from.mockReturnValue(chain)
    expect(await setQuoteStatus({ id: quoteId, status: "accepted" })).toEqual({ error: "Cannot change a draft quote to accepted." })
    expect(fixture.from).toHaveBeenCalledTimes(1)
  })
})

describe("service action amount boundaries", () => {
  it("rejects an overprecise quote discount before database calls", async () => {
    expect(await createQuote({ client_id: quoteId, discountBaht: "1.001" })).toEqual({ error: "Invalid input" })
    expect(fixture.from).not.toHaveBeenCalled()
  })
  it("rejects an unsafe project budget before database calls", async () => {
    expect(await createProject({ name: "Service", status: "not_started", budgetBaht: "90071992547409.92" })).toEqual({ error: "Invalid input" })
    expect(fixture.from).not.toHaveBeenCalled()
  })
  it("rejects quantities that PostgreSQL would silently round", async () => {
    expect(await addQuoteItem({ quote_id: quoteId, description: "Service", quantity: "1.0001", unitPriceBaht: 1 })).toEqual({ error: "Invalid input" })
    expect(fixture.from).not.toHaveBeenCalled()
  })
  it("submits exact line amounts and leaves quote totals to the database", async () => {
    let inserted: Record<string, unknown> | undefined
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data: { status: "draft" }, error: null }),
      insert: async (row: Record<string, unknown>) => { inserted = row; return { error: null } },
      then: (resolve: (value: unknown) => unknown) => resolve({ count: 0, error: null }),
    }
    fixture.from.mockReturnValue(chain)
    expect(await addQuoteItem({ quote_id: quoteId, description: "Service", quantity: "1.005", unitPriceBaht: "1.00" })).toEqual({})
    expect(inserted).toMatchObject({ org_id: fixture.ctx.orgId, quote_id: quoteId, unit_price_satang: 100, amount_satang: 101 })
    expect(fixture.from.mock.calls.map((call) => call[0])).toEqual(["quotes", "quote_items", "org_settings", "quote_items"])
  })
})
