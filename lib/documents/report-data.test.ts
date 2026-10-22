import { expect, it, vi } from "vitest"
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", orgName: "Workspace" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/dates", async importOriginal => ({ ...(await importOriginal<object>()), currentMonthKey: () => "2026-10", todayISO: () => "2026-10-13" }))
import { getReportData } from "@/app/(app)/reports/_data"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

it("includes a first-day Bangkok receipt at the oldest report month boundary", async () => {
  const receipts = [
    { paid_at: "2026-04-30T17:00:00Z", amount_satang: 101, invoices: { clients: { name: "Client" } } },
    { paid_at: "2026-10-01T00:00:00Z", amount_satang: 200, invoices: { clients: { name: "Client" } } },
  ]
  from.mockImplementation((table: string) => {
    let lower = ""
    const query = {
      select: () => query, eq: () => query, order: () => query, range: () => query,
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

it("reports monthly delivery COGS net of customer returns, scoped to the workspace and range", async () => {
  const client = databaseFixture({ monthly_inventory_cogs: [
    { org_id: "active-org", month: "2026-04-01", amount_satang: 9999 },
    { org_id: "active-org", month: "2026-05-01", amount_satang: 1250 },
    { org_id: "active-org", month: "2026-10-01", amount_satang: -250 },
    { org_id: "active-org", month: "2026-11-01", amount_satang: 9999 },
    { org_id: "other-org", month: "2026-10-01", amount_satang: 9999 },
  ] })
  from.mockImplementation(client.from)
  const report = await getReportData()
  expect(report.cogsByMonth).toEqual([
    { month: "2026-05", amount_satang: 1250 },
    { month: "2026-06", amount_satang: 0 },
    { month: "2026-07", amount_satang: 0 },
    { month: "2026-08", amount_satang: 0 },
    { month: "2026-09", amount_satang: 0 },
    { month: "2026-10", amount_satang: -250 },
  ])
  expect(report.totalCogsSatang).toBe(1000)
})

it("pages report receipts and time past the API row cap", async () => {
  const client = databaseFixture({
    payments: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), org_id: "active-org", verification_state: "verified", paid_at: "2026-10-01", amount_satang: 1 })),
    time_entries: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), org_id: "active-org", work_date: "2026-10-01", minutes: 1, billable: true })),
  })
  from.mockImplementation(client.from)
  const report = await getReportData()
  expect(report.totalRevenueSatang).toBe(1001)
  expect(report.hours.totalMinutes).toBe(1001)
})
