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
