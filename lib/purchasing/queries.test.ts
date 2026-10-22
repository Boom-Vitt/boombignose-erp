import { expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
const state = vi.hoisted(() => ({ client: {} as unknown }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "A" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/dates", () => ({ todayISO: () => "2026-10-23" }))
import { overdueVendorBillCount } from "./queries"

it("counts only active-workspace unpaid vendor bills before today, beyond the API row cap", async () => {
  state.client = databaseFixture({ costs: [
    ...Array.from({ length: 1001 }, (_, id) => ({ id, org_id: "A", vendor_id: "vendor-A", due_date: "2026-10-22", paid_at: null })),
    { org_id: "B", vendor_id: "vendor-B", due_date: "2026-10-22", paid_at: null },
    { org_id: "A", vendor_id: "vendor-A", due_date: "2026-10-22", paid_at: "2026-10-21" },
    { org_id: "A", vendor_id: "vendor-A", due_date: "2026-10-23", paid_at: null },
    { org_id: "A", vendor_id: null, due_date: "2026-10-22", paid_at: null },
  ] })
  expect(await overdueVendorBillCount()).toBe(1001)
})
it("does not report an invented zero when the count query fails", async () => {
  const query = { select: () => query, eq: () => query, not: () => query, is: () => query, lt: async () => ({ count: null, error: { message: "offline" } }) }
  state.client = { from: () => query }
  await expect(overdueVendorBillCount()).rejects.toThrow("Vendor bill attention count unavailable")
})
