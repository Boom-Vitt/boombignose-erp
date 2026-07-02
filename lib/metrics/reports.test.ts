import { describe, it, expect } from "vitest"

import {
  pivot,
  revenueByClientMonth,
  hoursByProject,
  minutesToHours,
  billableValueSatang,
  totalRevenueSatang,
  type ClientPayment,
  type ProjectTimeEntry,
} from "@/lib/metrics/reports"

describe("pivot", () => {
  type Sale = { region: string; quarter: string; amount: number }
  const sales: Sale[] = [
    { region: "North", quarter: "Q1", amount: 10 },
    { region: "North", quarter: "Q1", amount: 5 },
    { region: "North", quarter: "Q2", amount: 20 },
    { region: "South", quarter: "Q2", amount: 7 },
  ]

  const p = pivot(
    sales,
    (s) => s.region,
    (s) => s.quarter,
    (s) => s.amount
  )

  it("returns sorted, de-duplicated row and column keys", () => {
    expect(p.rowKeys).toEqual(["North", "South"])
    expect(p.colKeys).toEqual(["Q1", "Q2"])
  })

  it("sums values that share a (row, col) intersection", () => {
    expect(p.cell("North", "Q1")).toBe(15)
    expect(p.cell("North", "Q2")).toBe(20)
    expect(p.cell("South", "Q2")).toBe(7)
  })

  it("returns 0 for empty intersections", () => {
    expect(p.cell("South", "Q1")).toBe(0)
    expect(p.cell("East", "Q9")).toBe(0)
  })

  it("computes row, column and grand totals", () => {
    expect(p.rowTotal("North")).toBe(35)
    expect(p.rowTotal("South")).toBe(7)
    expect(p.colTotal("Q1")).toBe(15)
    expect(p.colTotal("Q2")).toBe(27)
    expect(p.grandTotal).toBe(42)
  })

  it("handles an empty input", () => {
    const empty = pivot<Sale>(
      [],
      (s) => s.region,
      (s) => s.quarter,
      (s) => s.amount
    )
    expect(empty.rowKeys).toEqual([])
    expect(empty.colKeys).toEqual([])
    expect(empty.grandTotal).toBe(0)
    expect(empty.cell("x", "y")).toBe(0)
  })
})

describe("revenueByClientMonth", () => {
  const payments: ClientPayment[] = [
    { client_name: "Acme", amount_satang: 100_000, paid_at: "2026-05-10" },
    { client_name: "Acme", amount_satang: 50_000, paid_at: "2026-06-02" },
    { client_name: "Beta", amount_satang: 25_000, paid_at: "2026-06-20" },
    { client_name: "Acme", amount_satang: 5_000, paid_at: "2026-06-28" },
  ]
  // Precomputed month key: take the first 7 chars ('YYYY-MM').
  const monthKeyOf = (paidAt: string) => paidAt.slice(0, 7)

  const p = revenueByClientMonth(payments, monthKeyOf)

  it("pivots satang by client × month", () => {
    expect(p.rowKeys).toEqual(["Acme", "Beta"])
    expect(p.colKeys).toEqual(["2026-05", "2026-06"])
    expect(p.cell("Acme", "2026-05")).toBe(100_000)
    expect(p.cell("Acme", "2026-06")).toBe(55_000)
    expect(p.cell("Beta", "2026-06")).toBe(25_000)
    expect(p.cell("Beta", "2026-05")).toBe(0)
  })

  it("totals stay in integer satang", () => {
    expect(p.rowTotal("Acme")).toBe(155_000)
    expect(p.colTotal("2026-06")).toBe(80_000)
    expect(p.grandTotal).toBe(180_000)
  })
})

describe("hoursByProject", () => {
  const entries: ProjectTimeEntry[] = [
    { project_name: "Website", minutes: 60, billable: true },
    { project_name: "Website", minutes: 30, billable: false },
    { project_name: "Website", minutes: 90, billable: true },
    { project_name: "App", minutes: 45, billable: true },
  ]

  const result = hoursByProject(entries)

  it("rolls up minutes per project with a billable split", () => {
    // sorted by name: App, Website
    expect(result.projects.map((p) => p.project_name)).toEqual([
      "App",
      "Website",
    ])
    const website = result.projects.find((p) => p.project_name === "Website")!
    expect(website.totalMinutes).toBe(180)
    expect(website.billableMinutes).toBe(150)
    expect(website.nonBillableMinutes).toBe(30)
    expect(website.totalHours).toBe(3)
    expect(website.billableHours).toBe(2.5)
  })

  it("computes overall totals", () => {
    expect(result.totalMinutes).toBe(225)
    expect(result.billableMinutes).toBe(195)
    expect(result.totalHours).toBe(3.75)
    expect(result.billableHours).toBe(3.25)
  })

  it("handles empty input", () => {
    const empty = hoursByProject([])
    expect(empty.projects).toEqual([])
    expect(empty.totalMinutes).toBe(0)
    expect(empty.billableHours).toBe(0)
  })
})

describe("minutesToHours", () => {
  it("converts minutes to hours rounded to 2 decimals", () => {
    expect(minutesToHours(60)).toBe(1)
    expect(minutesToHours(90)).toBe(1.5)
    expect(minutesToHours(50)).toBe(0.83)
    expect(minutesToHours(0)).toBe(0)
  })
})

describe("billableValueSatang", () => {
  it("multiplies billable hours by an hourly satang rate, rounded to whole satang", () => {
    // 90 min = 1.5h at ฿1,000/h (100000 satang) = 150000 satang
    expect(billableValueSatang(90, 100_000)).toBe(150_000)
    // 50 min at 120000 satang/h = 0.8333h * 120000 = 100000 satang
    expect(billableValueSatang(50, 120_000)).toBe(100_000)
    expect(billableValueSatang(0, 100_000)).toBe(0)
  })
})

describe("totalRevenueSatang", () => {
  it("sums all payment satang", () => {
    expect(
      totalRevenueSatang([
        { client_name: "A", amount_satang: 100, paid_at: "2026-01-01" },
        { client_name: "B", amount_satang: 250, paid_at: "2026-02-01" },
      ])
    ).toBe(350)
    expect(totalRevenueSatang([])).toBe(0)
  })
})
