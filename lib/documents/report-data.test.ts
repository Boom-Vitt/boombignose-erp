import { expect, it, vi } from "vitest"
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", orgName: "Workspace" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/dates", async importOriginal => ({ ...(await importOriginal<object>()), currentMonthKey: () => "2026-10", todayISO: () => "2026-10-13" }))
import { getReportData } from "@/app/(app)/reports/_data"

it("includes a first-day Bangkok receipt at the oldest report month boundary", async () => {
  const receipts = [
    { paid_at: "2026-04-30T17:00:00Z", amount_satang: 101, invoices: { clients: { name: "Client" } } },
    { paid_at: "2026-10-01T00:00:00Z", amount_satang: 200, invoices: { clients: { name: "Client" } } },
  ]
  from.mockImplementation((table: string) => {
    let lower = ""
    const query = {
      select: () => query, eq: () => query,
      gte: (_column: string, value: string) => { lower = value; return query },
      then: (resolve: (value: object) => void) => resolve({ data: table === "payments" ? receipts.filter(receipt => Date.parse(receipt.paid_at) >= Date.parse(lower)) : [], error: null }),
    }
    return query
  })
  const report = await getReportData()
  expect(report.months[0]).toBe("2026-05")
  expect(report.revenue.cell("Client", "2026-05")).toBe(101)
  expect(report.totalRevenueSatang).toBe(301)
})
