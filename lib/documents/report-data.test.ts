import { expect, it, vi } from "vitest"
const { from } = vi.hoisted(() => ({ from: vi.fn() }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "active-org", orgName: "Workspace" }) }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from }) }))
vi.mock("@/lib/dates", async importOriginal => ({ ...(await importOriginal<object>()), currentMonthKey: () => "2026-10", todayISO: () => "2026-10-13" }))
import { getReportData } from "@/app/(app)/reports/_data"

function serve(invoices: object[], entries: object[] = [], failPage = false) {
  from.mockImplementation((table: string) => {
    let lower = "", offset = 0, end = 999
    const query = {
      select: () => query, eq: () => query, not: () => query, order: () => query,
      gte: (_column: string, value: string) => { lower = value; return query },
      range: (start: number, to: number) => { offset = start; end = to; return query },
      then: (resolve: (value: object) => void) => {
        const rows = (table === "invoices" ? invoices : entries) as { issue_date?: string; work_date?: string }[]
        return resolve(failPage && offset > 0 ? { data: null, error: { message: "Page failed" } } : {
          data: rows.filter(row => (row.issue_date ?? row.work_date ?? "") >= lower).slice(offset, end + 1), error: null,
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
it("includes revenue and hours past the 1,000-row API cap", async () => {
  serve(Array.from({ length: 1001 }, () => ({ issue_date: "2026-10-01", total_satang: 107, vat_satang: 7, status: "sent", clients: { name: "Client" } })),
    Array.from({ length: 1001 }, () => ({ work_date: "2026-10-01", minutes: 60, billable: true, projects: { name: "Project" } })))
  const report = await getReportData()
  expect(report.totalRevenueSatang).toBe(100100)
  expect(report.hours.totalMinutes).toBe(60060)
})
it("fails closed when any aggregate page fails", async () => {
  serve(Array.from({ length: 1001 }, () => ({ issue_date: "2026-10-01", total_satang: 100, vat_satang: 0, status: "sent" })), [], true)
  await expect(getReportData()).rejects.toThrow("Operational reports unavailable")
})
