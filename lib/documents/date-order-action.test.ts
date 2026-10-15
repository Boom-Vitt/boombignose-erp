import { beforeEach, expect, it, vi } from "vitest"

const { client } = vi.hoisted(() => ({ client: vi.fn() }))
vi.mock("@/lib/auth", () => ({
  requireOrgContext: async () => ({ userId: "actor", orgId: "org", orgName: "Workspace", role: "owner", email: null }),
  requireCapability: () => undefined,
  requireRole: () => undefined,
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: client }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({ redirect: vi.fn() }))

import { createInvoice, updateInvoice } from "@/app/(app)/finance/actions"
import { createQuote, updateQuote } from "@/app/(app)/quotes/actions"

const id = "00000000-0000-4000-8000-000000000001"
const client_id = "00000000-0000-4000-8000-000000000002"

beforeEach(() => {
  vi.clearAllMocks()
  client.mockRejectedValue(new Error("no database in this test"))
})

it("refuses an invoice due before it is issued, before touching the database", async () => {
  const due = { error: "Due date cannot be before the issue date" }
  expect(await createInvoice({ client_id, amountBaht: "100", issue_date: "2026-10-10", due_date: "2026-10-09" })).toEqual(due)
  expect(await updateInvoice({ id, client_id, amountBaht: "100", status: "draft", is_recurring: false, issue_date: "2026-10-10", due_date: "2026-10-09" })).toEqual(due)
  expect(client).not.toHaveBeenCalled()
})

it("refuses a quote that expires before it is issued, before touching the database", async () => {
  const until = { error: "Valid until cannot be before the issue date" }
  expect(await createQuote({ client_id, issue_date: "2026-10-10", valid_until: "2026-10-09" })).toEqual(until)
  expect(await updateQuote({ id, client_id, discountBaht: 0, issue_date: "2026-10-10", valid_until: "2026-10-09" })).toEqual(until)
  expect(client).not.toHaveBeenCalled()
})

it("checks a new document without an issue date against today in Bangkok", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-15T20:00:00Z") }) // 16 Oct, 03:00 in Bangkok
  try {
    expect((await createInvoice({ client_id, amountBaht: "100", due_date: "2026-10-15" })).error).toMatch(/before the issue date/)
    expect((await createQuote({ client_id, valid_until: "2026-10-15" })).error).toMatch(/before the issue date/)
    // Same-day dates pass the check and reach the database.
    await expect(createQuote({ client_id, valid_until: "2026-10-16" })).rejects.toThrow("no database")
  } finally {
    vi.useRealTimers()
  }
})
