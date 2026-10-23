import { describe, expect, it } from "vitest"
import { creditableBillLines } from "./credit-matching"

const first = "a6000000-0000-0000-0000-000000000001"
const second = "b6000000-0000-0000-0000-000000000002"
const item = "c6000000-0000-0000-0000-000000000003"
const originals = [
  { id: first, kind: "bill" as const, vendor_reference: "INV-A", original_bill_id: null, lines: [{ id: item, quantity: 5, expected_quantity: 4, amount_satang: 500 }] },
  { id: second, kind: "bill" as const, vendor_reference: "INV-B", original_bill_id: null, lines: [{ id: item, quantity: 6, expected_quantity: 6, amount_satang: 900 }] },
]
const costs = originals.map((bill, i) => ({ vendor_bill_match_id: bill.id, purchase_cost_kind: "bill" as const, input_vat_rate: i ? 0 : 7 }))
const lines = [{ id: item, description: "Service", returned_quantity: 10, billed_quantity: 0 }]

describe("vendor credit quantities by original invoice", () => {
  it("uses physical matched quantities and immutable original VAT rates", () => {
    expect(creditableBillLines(originals, costs, lines)).toEqual([
      { original_bill_id: first, vendor_reference: "INV-A", input_vat_rate: 7, lines: [{ id: item, description: "Service", remaining_quantity: 4, maximum_quantity: 4 }] },
      { original_bill_id: second, vendor_reference: "INV-B", input_vat_rate: 0, lines: [{ id: item, description: "Service", remaining_quantity: 6, maximum_quantity: 6 }] },
    ])
  })

  it("subtracts legacy and multi-original credits by UUID identity", () => {
    const credits = [
      { id: "d6000000-0000-0000-0000-000000000004", kind: "credit" as const, vendor_reference: "CN-A", original_bill_id: first.toUpperCase(), lines: [{ id: item.toUpperCase(), quantity: 1 }] },
      { id: "e6000000-0000-0000-0000-000000000005", kind: "credit" as const, vendor_reference: "CN-AB", original_bill_id: null, lines: [{ original_bill_id: first, id: item, quantity: 0.25 }, { original_bill_id: second, id: item, quantity: 1.5 }] },
    ]
    expect(creditableBillLines([...originals, ...credits], costs, lines).map(bill => bill.lines[0].remaining_quantity)).toEqual([2.75, 4.5])
  })

  it("caps every original at the uncredited physical billed returns", () => {
    const credit = { id: "d6000000-0000-0000-0000-000000000004", kind: "credit" as const, vendor_reference: "CN-A", original_bill_id: first, lines: [{ id: item, quantity: 1 }] }
    const result = creditableBillLines([...originals, credit], costs, [{ ...lines[0], returned_quantity: 2, billed_quantity: 8 }])
    expect(result.map(bill => bill.lines[0])).toEqual([
      { id: item, description: "Service", remaining_quantity: 3, maximum_quantity: 1 },
      { id: item, description: "Service", remaining_quantity: 6, maximum_quantity: 1 },
    ])
    expect(creditableBillLines(originals, costs, [{ ...lines[0], returned_quantity: 3, billed_quantity: 10 }])).toEqual([])
  })

  it("uses thousandths so fully credited fractional lines disappear", () => {
    const bill = { ...originals[0], lines: [{ id: item, expected_quantity: 0.3 }] }
    const credit = { id: second, kind: "credit" as const, vendor_reference: "CN-A", original_bill_id: first, lines: [{ id: item, quantity: 0.1 }, { id: item, quantity: 0.2 }] }
    expect(creditableBillLines([bill, credit], costs, [{ ...lines[0], returned_quantity: 0.3 }])).toEqual([])
  })

  it("refuses malformed or unattributed evidence instead of inventing quantities", () => {
    for (const evidence of [null, [], [{ id: item, expected_quantity: -1 }], [{ id: item, expected_quantity: 0.0001 }]]) {
      expect(() => creditableBillLines([{ ...originals[0], lines: evidence }], costs, lines)).toThrow(/reconciliation/i)
    }
    const credit = { id: second, kind: "credit" as const, vendor_reference: "CN-A", original_bill_id: null, lines: [{ id: item, quantity: 1 }] }
    expect(() => creditableBillLines([...originals, credit], costs, lines)).toThrow(/reconciliation/i)
  })
})
