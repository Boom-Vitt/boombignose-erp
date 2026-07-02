import { describe, it, expect } from "vitest"

import { renderReportHtml, type ReportData } from "@/lib/documents/report"
import {
  revenueByClientMonth,
  hoursByProject,
  type ClientPayment,
  type ProjectTimeEntry,
} from "@/lib/metrics/reports"

function buildData(overrides: Partial<ReportData> = {}): ReportData {
  const payments: ClientPayment[] = [
    { client_name: "Acme", amount_satang: 100_000, paid_at: "2026-05-10" },
    { client_name: "Acme", amount_satang: 55_000, paid_at: "2026-06-02" },
    { client_name: "Beta", amount_satang: 25_000, paid_at: "2026-06-20" },
  ]
  const entries: ProjectTimeEntry[] = [
    { project_name: "Website", minutes: 120, billable: true },
    { project_name: "Website", minutes: 30, billable: false },
  ]
  return {
    orgName: "Studio",
    generatedAt: "Generated 2026-07-02",
    rangeLabel: "2026-05 – 2026-06",
    totalRevenueSatang: 180_000,
    revenue: revenueByClientMonth(payments, (p) => p.slice(0, 7)),
    hours: hoursByProject(entries),
    ...overrides,
  }
}

describe("renderReportHtml", () => {
  it("renders a self-contained HTML document", () => {
    const html = renderReportHtml(buildData())
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("<title>Operational report — Studio</title>")
    expect(html).toContain("Revenue by client × month")
    expect(html).toContain("Hours by project")
  })

  it("includes pivot row/column labels and formatted money", () => {
    const html = renderReportHtml(buildData())
    expect(html).toContain("Acme")
    expect(html).toContain("Beta")
    expect(html).toContain("2026-05")
    expect(html).toContain("2026-06")
    // ฿1,000.00 for 100000 satang and grand total ฿1,800.00
    expect(html).toContain("1,000.00")
    expect(html).toContain("1,800.00")
  })

  it("renders hours with billable split", () => {
    const html = renderReportHtml(buildData())
    expect(html).toContain("Website")
    expect(html).toContain("2.50 h") // 150 total minutes
    expect(html).toContain("2.00 h") // 120 billable minutes
  })

  it("escapes HTML-significant characters in interpolated text", () => {
    const payments: ClientPayment[] = [
      {
        client_name: "<script>Evil</script>",
        amount_satang: 100,
        paid_at: "2026-06-01",
      },
    ]
    const html = renderReportHtml(
      buildData({
        orgName: "A & B <Co>",
        revenue: revenueByClientMonth(payments, (p) => p.slice(0, 7)),
      })
    )
    expect(html).toContain("A &amp; B &lt;Co&gt;")
    expect(html).toContain("&lt;script&gt;Evil&lt;/script&gt;")
    expect(html).not.toContain("<script>Evil</script>")
  })

  it("shows empty-state copy when there is no data", () => {
    const html = renderReportHtml(
      buildData({
        revenue: revenueByClientMonth([], (p) => p.slice(0, 7)),
        hours: hoursByProject([]),
      })
    )
    expect(html).toContain("No payments in this range.")
    expect(html).toContain("No time logged in this range.")
  })
})
