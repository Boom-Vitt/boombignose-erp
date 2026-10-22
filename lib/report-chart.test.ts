import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, it } from "vitest"
import { ReportChart } from "@/app/(app)/reports/_components/report-chart"

describe("report charts", () => {
  const rows = [{ label: "2026-09", value: 101 }, { label: "2026-10", value: 202 }]
  it("renders exact money labels alongside CSS bars", () => {
    const html = renderToStaticMarkup(createElement(ReportChart, { title: "Revenue by month", rows, kind: "bar", unit: "satang" }))
    expect(html).toContain("Revenue by month bar chart")
    expect(html).toContain("฿1.01")
    expect(html).toContain("฿2.02")
    expect(html).toContain("height:50%")
    expect(html).toContain("height:100%")
  })
  it("renders a line aligned with its labelled values", () => {
    const html = renderToStaticMarkup(createElement(ReportChart, { title: "Hours by project", rows, kind: "line", unit: "hours" }))
    expect(html).toContain('points="25,100 75,20"')
    expect(html).toContain("2026-09")
    expect(html).toContain("101.00 h")
  })
  it("handles empty and all-zero data without invalid coordinates", () => {
    const empty = renderToStaticMarkup(createElement(ReportChart, { title: "Revenue", rows: [], kind: "line", unit: "satang" }))
    expect(empty).toContain("No data in range")
    const zero = renderToStaticMarkup(createElement(ReportChart, { title: "Revenue", rows: [{ label: "Oct", value: 0 }], kind: "line", unit: "satang" }))
    expect(zero).toContain('points="50,180"')
    expect(zero).toContain("All values are zero")
    expect(zero).not.toMatch(/NaN|Infinity/)
  })
})
