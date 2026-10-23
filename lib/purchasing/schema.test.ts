import { parseFacets } from "@/lib/search-facets"
import { expect, it } from "vitest"
import { LineInput, PurchaseInput, ReceiptInput, VendorInput } from "./schema"
const vendor = { name: "Test vendor", tax_id: "", email: "", phone: "", address: "", notes: "", active: true, payment_terms_days: 30 }
it("validates supplier identity, email and bounded payment terms", () => {
  expect(VendorInput.parse(vendor).email).toBeNull()
  for (const patch of [{ name: " " }, { email: "bad" }, { payment_terms_days: -1 }, { payment_terms_days: 3651 }]) expect(VendorInput.safeParse({ ...vendor, ...patch }).success).toBe(false)
})
it("rejects invalid purchase references and noncalendar dates", () => {
  expect(PurchaseInput.safeParse({ vendor_id: "other-org", order_date: "2026-02-31", expected_date: "", notes: "" }).success).toBe(false)
  expect(PurchaseInput.safeParse({ vendor_id: "b6000000-0000-4000-8000-000000000020", order_date: "2026-02-31", expected_date: "", notes: "" }).success).toBe(false)
})
it("rejects invalid money and receipt targets at the action boundary", () => {
  const line = { purchase_order_id: "b6000000-0000-4000-8000-000000000020", product_id: null, description: "Snapshot", quantity: 1, unit: "piece", unitCostBaht: "1.001" }
  expect(LineInput.safeParse(line).success).toBe(false)
  expect(ReceiptInput.safeParse([{ id: line.purchase_order_id, received_quantity: -1 }]).success).toBe(false)
  expect(ReceiptInput.safeParse([{ id: line.purchase_order_id, received_quantity: Infinity }]).success).toBe(false)
})
it("accepts seed-shaped references that lack RFC 9562 version bits", () => {
  const [vendorId, order, item, product] = ["60000000-0000-0000-0000-000000000001", "70000000-0000-0000-0000-000000000001", "70000000-0000-0000-0000-000000000002", "50000000-0000-0000-0000-000000000001"]
  expect(PurchaseInput.parse({ vendor_id: vendorId, order_date: "2026-02-28", expected_date: "", notes: "" }).vendor_id).toBe(vendorId)
  expect(LineInput.parse({ purchase_order_id: order, product_id: product, description: "Snapshot", quantity: 1, unit: "piece", unitCostBaht: "1.00" })).toMatchObject({ purchase_order_id: order, product_id: product })
  expect(ReceiptInput.parse([{ id: item, received_quantity: 1, previous_received_quantity: 0 }])).toEqual([{ id: item, received_quantity: 1, previous_received_quantity: 0 }])
})

it("registers closed purchases in list and saved-view facets", () => {
  expect(parseFacets({ status: "closed" }, "purchases")).toEqual({ status: "closed" })
})

it("validates complete vendor invoice evidence and credit references", async () => {
  const { BillInput, CreditInput } = await import("./schema")
  const bill = { vendor_reference: " SUP-1 ", bill_date: "2026-10-01", due_date: "2026-10-15", input_vat_rate: 7, input_vat_satang: 7, vendor_total_satang: 107, variance_reason: "", lines: [{ id: "a6000000-0000-0000-0000-000000000001", quantity: 1, expected_quantity: 1, unit_cost_satang: 100 }] }
  expect(BillInput.parse(bill).vendor_reference).toBe("SUP-1")
  for (const patch of [{ vendor_reference: " " }, { bill_date: "2026-02-30" }, { due_date: "2026-09-30" }, { vendor_total_satang: 6 }, { input_vat_satang: -1 }, { input_vat_rate: 7.001 }, { lines: [] }]) expect(BillInput.safeParse({ ...bill, ...patch }).success).toBe(false)
  expect(CreditInput.parse({ ...bill, cost_ids: [bill.lines[0].id], original_bill_id: bill.lines[0].id })).toEqual({ vendor_reference: "SUP-1", bill_date: bill.bill_date, input_vat_satang: 7, variance_reason: "", cost_ids: [bill.lines[0].id], allocations: [{ original_bill_id: bill.lines[0].id, lines: [{ id: bill.lines[0].id, quantity: 1 }] }] })
  expect(CreditInput.safeParse({ ...bill, original_bill_id: "bad" }).success).toBe(false)
  for (const patch of [{ lines: [] }, { lines: [{ id: bill.lines[0].id, quantity: 0 }] }, { cost_ids: [] }, { cost_ids: ["bad"] }]) expect(CreditInput.safeParse({ ...bill, original_bill_id: bill.lines[0].id, ...patch }).success).toBe(false)
})

it("validates one credit across multiple originals without an editable VAT rate", async () => {
  const { CreditInput } = await import("./schema")
  const first = "a6000000-0000-0000-0000-000000000001"
  const second = "b6000000-0000-0000-0000-000000000002"
  const allocation = { original_bill_id: first, lines: [{ id: first, quantity: 0.001 }] }
  const credit = { vendor_reference: " CN-AB ", bill_date: "2026-10-01", input_vat_satang: 7, cost_ids: [first], allocations: [allocation, { ...allocation, original_bill_id: second }] }
  expect(CreditInput.parse(credit)).toEqual({ ...credit, vendor_reference: "CN-AB", variance_reason: "" })
  expect(CreditInput.parse({ ...credit, input_vat_rate: 100 })).not.toHaveProperty("input_vat_rate")
  for (const patch of [
    { allocations: [] },
    { allocations: [{ ...allocation, original_bill_id: "bad" }] },
    { allocations: [allocation, { ...allocation, original_bill_id: first.toUpperCase() }] },
    { allocations: [{ ...allocation, lines: [] }] },
    { allocations: [{ ...allocation, lines: [{ id: first, quantity: 0 }] }] },
    { allocations: [{ ...allocation, lines: [...allocation.lines, { id: first.toUpperCase(), quantity: 1 }] }] },
    { cost_ids: [first, first.toUpperCase()] },
    { input_vat_satang: -1 },
  ]) expect(CreditInput.safeParse({ ...credit, ...patch }).success).toBe(false)
})
