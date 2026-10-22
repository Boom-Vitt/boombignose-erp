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
