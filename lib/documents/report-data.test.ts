import { expect, it, vi } from "vitest"
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", orgName: "Workspace" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/dates", async importOriginal => ({ ...(await importOriginal<object>()), currentMonthKey: () => "2026-10", todayISO: () => "2026-10-13" }))
import { getReportData } from "@/app/(app)/reports/_data"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

function serve(invoices: object[], entries: object[] = [], failPage = false, overlapPage = false) {
  from.mockImplementation((table: string) => {
    let lower = "", offset = 0, end = 999, includeId = false
    const query = {
      select: (columns: string) => { includeId = columns.split(",").some(column => column.trim() === "id"); return query },
      eq: () => query, not: () => query, order: () => query,
      gte: (_column: string, value: string) => { lower = value; return query },
      range: (start: number, to: number) => { offset = start; end = to; return query },
      then: (resolve: (value: object) => void) => {
        const rows = (table === "invoices" ? invoices : table === "time_entries" ? entries : []) as { id?: string; issue_date?: string; work_date?: string }[]
        if (overlapPage && offset === 1000) rows.unshift({ ...rows[0], id: "inserted-before-page" })
        return resolve(failPage && offset > 0 ? { data: null, error: { message: "Page failed" } } : {
          data: rows.filter(row => (row.issue_date ?? row.work_date ?? "") >= lower).slice(offset, end + 1)
            .map(row => { const projected = { ...row }; if (!includeId) delete projected.id; return projected }), error: null,
        })
      },
    }
    return query
  })
}
it("recognizes issued pre-VAT base in the issue month including the oldest boundary", async () => {
  serve([
    { issue_date: "2026-05-01", total_satang: 108, vat_satang: 7, status: "sent", clients: { name: "Client" } },
    { issue_date: "2026-10-01", total_satang: 214, vat_satang: 14, status: "paid", clients: { name: "Client" } },
    { issue_date: "2026-10-02", total_satang: 999, vat_satang: 0, status: "draft", clients: { name: "Client" } },
    { issue_date: "2026-10-03", total_satang: 999, vat_satang: 0, status: "cancelled", clients: { name: "Client" } },
  ])
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

it("pages issued invoice revenue and time past the API row cap", async () => {
  const client = databaseFixture({
    invoices: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), org_id: "active-org", status: "sent", issue_date: "2026-10-01", total_satang: 1, vat_satang: 0 })),
    time_entries: Array.from({ length: 1001 }, (_, i) => ({ id: String(i), org_id: "active-org", work_date: "2026-10-01", minutes: 1, billable: true })),
  })
  from.mockImplementation(client.from)
  const report = await getReportData()
  expect(report.totalRevenueSatang).toBe(1001)
  expect(report.hours.totalMinutes).toBe(1001)
})
it("includes revenue and hours past the 1,000-row API cap", async () => {
  serve(Array.from({ length: 1001 }, () => ({ issue_date: "2026-10-01", total_satang: 107, vat_satang: 7, status: "sent", clients: { name: "Client" } })),
    Array.from({ length: 1001 }, () => ({ work_date: "2026-10-01", minutes: 60, billable: true, projects: { name: "Project" } })))
  const report = await getReportData()
  expect(report.totalRevenueSatang).toBe(100100)
  expect(report.hours.totalMinutes).toBe(60060)
})
it("counts each invoice and time entry once when an insertion overlaps page boundaries", async () => {
  serve(
    Array.from({ length: 1001 }, (_, id) => ({ id: String(id), issue_date: "2026-10-01", total_satang: 107, vat_satang: 7, status: "sent" })),
    Array.from({ length: 1001 }, (_, id) => ({ id: String(id), work_date: "2026-10-01", minutes: 60, billable: true })),
    false, true,
  )
  const report = await getReportData()
  expect.soft(report.totalRevenueSatang).toBe(100100)
  expect.soft(report.hours.totalMinutes).toBe(60060)
})
it("fails closed when any aggregate page fails", async () => {
  serve(Array.from({ length: 1001 }, () => ({ issue_date: "2026-10-01", total_satang: 100, vat_satang: 0, status: "sent" })), [], true)
  await expect(getReportData()).rejects.toThrow("Operational reports unavailable")
})
