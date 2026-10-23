import { describe, expect, it } from "vitest"
import { matchBill, defaultBillLines, billDueDate } from "./bill-matching"

const po = [{ id: "a", quantity: 4, received_quantity: 1.5, returned_quantity: 0, billed_quantity: 0, unit_cost_satang: 1234 }]
describe("vendor invoice matching", () => {
  it("defaults to received quantities at the PO cost and vendor terms", () => {
    const lines = defaultBillLines(po)
    expect(lines).toEqual([{ id: "a", quantity: 1.5, unit_cost_satang: 1234, expected_quantity: 1.5 }])
    expect(matchBill(po, lines, { vatRate: 7, toleranceBps: 100 })).toMatchObject({ subtotal: 1851, vat: 130, total: 1981, variances: [] })
    expect(billDueDate("2026-12-25", 14)).toBe("2027-01-08")
  })
  it("flags quantity, price and declared total variances above tolerance", () => {
    expect(matchBill(po, [{ ...defaultBillLines(po)[0], quantity: 2, unit_cost_satang: 1300 }], { vatRate: 7, vat: 182, total: 2782, toleranceBps: 100 }).variances).toEqual(["Quantity: a", "Price: a"])
    expect(matchBill(po, [{ ...defaultBillLines(po)[0], unit_cost_satang: 1235 }], { vatRate: 0, toleranceBps: 100 }).variances).toEqual([])
    expect(matchBill(po, defaultBillLines(po), { vatRate: 7, vat: 129, toleranceBps: 100 }).variances).toEqual([])
  })
  it("bounds VAT rounding and requires a coherent taxable base and total", () => {
    const lines = defaultBillLines(po)
    expect(matchBill(po, lines, { vatRate: 7, vat: 133, toleranceBps: 100 }).vat).toBe(133)
    for (const options of [{ vatRate: 7, vat: 134 }, { vatRate: 0, vat: 1 }, { vatRate: 7, vat: 1851 }, { vatRate: 7, total: 2000 }]) {
      expect(() => matchBill(po, lines, { toleranceBps: 100, ...options })).toThrow()
    }
  })
  it("compares UUID identities and requires the exact eligible line set", () => {
    const id = "a6000000-0000-0000-0000-000000000001"
    const items = [{ ...po[0], id }, { ...po[0], id: "b6000000-0000-0000-0000-000000000002" }]
    const first = defaultBillLines(items)[0]
    expect(() => matchBill(items, [first, { ...first, id: id.toUpperCase() }], { vatRate: 0, toleranceBps: 0 })).toThrow()
    expect(matchBill(items, defaultBillLines(items).map(line => ({ ...line, id: line.id.toUpperCase() })), { vatRate: 0, toleranceBps: 0 }).subtotal).toBe(3702)
  })
  it("handles a free PO line without dividing by zero", () => {
    const free = [{ ...po[0], unit_cost_satang: 0 }]
    expect(matchBill(free, [{ ...defaultBillLines(free)[0], unit_cost_satang: 1 }], { vatRate: 0, toleranceBps: 100 }).variances).toEqual(["Price: a"])
  })
  it("preserves cumulative rounding across partial receipts and returns", () => {
    const partial = [{ ...po[0], received_quantity: 2.5, billed_quantity: 1.25, unit_cost_satang: 101 }]
    expect(matchBill(partial, defaultBillLines(partial), { vatRate: 0, toleranceBps: 0 }).total).toBe(127)
    expect(defaultBillLines([{ ...partial[0], returned_quantity: 1.25 }])).toEqual([])
  })
  it("rejects missing, duplicate, stale, foreign, invalid or unsafe lines", () => {
    const lines = defaultBillLines(po)
    for (const input of [[], [...lines, ...lines], [{ ...lines[0], id: "foreign" }], [{ ...lines[0], expected_quantity: 2 }], [{ ...lines[0], quantity: -1 }], [{ ...lines[0], quantity: 0.0001 }], [{ ...lines[0], unit_cost_satang: Number.MAX_SAFE_INTEGER }]]) {
      expect(() => matchBill(po, input, { vatRate: 7, toleranceBps: 100 })).toThrow()
    }
    expect(() => matchBill(po, lines, { vatRate: 101, toleranceBps: 100 })).toThrow()
    expect(() => matchBill(po, lines, { vatRate: 7, vat: 1982, total: 1981, toleranceBps: 100 })).toThrow()
  })
})
