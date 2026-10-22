import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ invoices: [] as unknown[] }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", userId: "me" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const query = {
    select: () => query,
    eq: () => query,
    order: () => query,
    range: () => query,
    then: (resolve: (result: unknown) => unknown) => resolve({ data: table === "invoices" ? state.invoices : [], error: null }),
  }
  return query
} }) }))

import { GET } from "@/app/(app)/finance/invoices/export/route"

const invoice = (number: string, status: string) => ({
  id: number, number, status, amount_satang: 100, discount_satang: 0, due_date: null, issue_date: "2026-10-01",
  source_quote_id: null, source_milestone_id: null, clients: { name: "Acme" },
})

beforeEach(() => {
  state.invoices = [invoice("INV-D", "draft"), invoice("INV-S", "sent"), invoice("INV-C", "cancelled")]
})

async function exported(query: string) {
  const text = await (await GET(new Request(`http://localhost/finance/invoices/export${query}`))).text()
  return ["INV-D", "INV-S", "INV-C"].filter((number) => text.includes(number))
}

describe("invoice CSV export status filter", () => {
  it.each([
    ["", ["INV-D", "INV-S", "INV-C"]],
    ["?status=draft", ["INV-D"]],
    ["?status=draft,sent", ["INV-D", "INV-S"]],
    ["?status=draft%2Csent", ["INV-D", "INV-S"]],
    ["?status=cancelled,nope,cancelled", ["INV-C"]],
    ["?status=nope", ["INV-D", "INV-S", "INV-C"]],
    ["?status=draft&status=sent", ["INV-D", "INV-S", "INV-C"]],
  ])("exports %j as %j", async (query, numbers) => {
    expect(await exported(query)).toEqual(numbers)
  })
})
