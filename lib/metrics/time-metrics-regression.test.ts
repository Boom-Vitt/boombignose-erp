import { describe, expect, it } from "vitest"
import { entryValueSatang, canEditTimeEntry, hourlyValueSatang } from "./timesheets"
import { billableValueSatang } from "./reports"
import { revenueForMonth } from "./finance"
import { projectProfit } from "./projects"

describe("I7 exact time valuation", () => {
  it("rounds a half satang once without floating point drift in both metrics", () => {
    expect(entryValueSatang({ project_id: "p", minutes: 11, billable: true, rate_satang: 150 })).toBe(28)
    expect(billableValueSatang(11, 150)).toBe(28)
  })
  it("keeps multiplication exact past safe-number intermediate products", () => {
    expect(hourlyValueSatang(61, 8_000_000_000_001_001)).toBe(8_133_333_333_334_351)
    expect(() => hourlyValueSatang(60, Number.MAX_SAFE_INTEGER + 1)).toThrow()
    expect(() => hourlyValueSatang(120, Number.MAX_SAFE_INTEGER)).toThrow()
    expect(() => hourlyValueSatang(-1, 100)).toThrow()
  })
})

describe("S9 issued revenue and labour", () => {
  it("uses invoice base in its issue month, including unpaid revenue and WHT", () => {
    const invoices = [
      { status: "sent" as const, issue_date: "2026-10-01", total_satang: 10700, vat_satang: 700, amount_satang: 10400, paid_at: "2026-10-01" },
      { status: "draft" as const, issue_date: "2026-10-02", total_satang: 9999, vat_satang: 0, amount_satang: 9999, paid_at: "2026-10-02" },
      { status: "cancelled" as const, issue_date: "2026-10-03", total_satang: 9999, vat_satang: 0, amount_satang: 9999, paid_at: "2026-10-03" },
      { status: "paid" as const, issue_date: "2026-09-30", total_satang: 1000, vat_satang: 0, amount_satang: 1000, paid_at: "2026-10-04" },
    ]
    expect(revenueForMonth(invoices, "2026-10")).toBe(10000)
  })
  it("subtracts the complete labour aggregate from project profit", () => {
    const result = projectProfit([{ status: "sent", total_satang: 10700, vat_satang: 700 }], [{ amount_satang: 1000, input_vat_satang: 0 }], 3028)
    expect(result.costSatang).toBe(4028)
    expect(result.profitSatang).toBe(5972)
  })
})

describe("S10 time editing authority", () => {
  const own = { user_id: "member", invoice_id: null, invoice_status: null }
  it("permits members only their own unbilled time and staff any unbilled time", () => {
    expect(canEditTimeEntry("member", "member", own)).toBe(true)
    expect(canEditTimeEntry("other", "member", own)).toBe(false)
    expect(canEditTimeEntry("other", "admin", own)).toBe(true)
    expect(canEditTimeEntry("other", "owner", own)).toBe(true)
  })
  it("freezes billed time even on draft invoices and permits cancelled invoices", () => {
    for (const invoice_status of ["draft", "sent", "paid", "partially_paid", "overdue"]) {
      expect(canEditTimeEntry("member", "owner", { ...own, invoice_id: "invoice", invoice_status })).toBe(false)
    }
    expect(canEditTimeEntry("member", "member", { ...own, invoice_id: "invoice", invoice_status: "cancelled" })).toBe(true)
  })
})
