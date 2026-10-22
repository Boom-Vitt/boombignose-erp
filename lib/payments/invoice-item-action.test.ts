import { beforeEach, expect, it, vi } from "vitest"
const { from, insert, update, ctx } = vi.hoisted(() => ({
  from: vi.fn(), insert: vi.fn(), update: vi.fn(),
  ctx: { orgId: "active-org", role: "owner" },
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ctx, requireRole: () => {}, requireCapability: () => {} }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { addInvoiceItem } from "@/app/(app)/finance/invoice-items-actions"

beforeEach(() => {
  vi.clearAllMocks()
  insert.mockResolvedValue({ error: null })
  from.mockImplementation(() => {
    const query = {
      select: () => query, eq: () => query, update, insert,
      maybeSingle: async () => ({ data: { status: "draft" }, error: null }),
      then: (resolve: (v: object) => void) => resolve({ count: 0, data: [{ amount_satang: 215 }], error: null }),
    }
    update.mockReturnValue(query)
    return query
  })
})

it("inserts one exact line and leaves authoritative discount/header recompute to the database", async () => {
  expect(await addInvoiceItem({ invoice_id: "invoice", description: "Service", quantity: "2.125", unitPriceBaht: "1.01" })).toEqual({})
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({ org_id: ctx.orgId, quantity: 2.125, unit_price_satang: 101, amount_satang: 215 }))
  expect(update).not.toHaveBeenCalled()
})
