import { expect, it, vi } from "vitest"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { DeliveryForm, CustomerReturnForm } from "@/app/(app)/inventory/_components/delivery-form"
import { PurchaseReturnForm } from "@/app/(app)/purchases/_components/receipt-form"
import { CountForm } from "@/app/(app)/inventory/_components/forms"
import type { Tables } from "@/lib/types/database"

vi.mock("@/app/(app)/purchases/actions", () => ({ receivePurchase: vi.fn(), returnPurchase: vi.fn() }))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/inventory/actions", () => ({ deliverInvoice: vi.fn(), returnInvoiceDelivery: vi.fn(), adjustStock: vi.fn(), saveReorder: vi.fn(), saveWarehouse: vi.fn() }))
const warehouse = { id: "warehouse", org_id: "org", code: "MAIN", name: "Main", address: null, active: true, is_default: true }

it("offers partial delivered totals and warns when issued stock exceeds availability", () => {
  const html = renderToStaticMarkup(createElement(DeliveryForm, { invoiceId: "invoice", lines: [{ id: "line", product_id: "product", description: "Paper", quantity: 4, unit: "box", delivered_quantity: 1, returned_quantity: 0 }], warehouses: [warehouse], products: [{ id: "product", quantity: 2, reserved_quantity: 3 }] }))
  expect(html).toMatch(/id="deliver-line"[^>]*min="1" max="4" step="0.001" required=""[^>]*value="1"/)
  expect(html).toContain('name="warehouse"')
  expect(html).toContain("Available -1 box")
  expect(html).toContain("Issued invoices exceed on-hand stock")
})

it("labels a customer return with the original delivery cost and warehouse", () => {
  const move = { id: "delivery", quantity: 3, unit_cost_satang: 12500, moved_at: "2026-10-23T00:00:00Z" } as Tables<"stock_moves">
  const html = renderToStaticMarkup(createElement(CustomerReturnForm, { invoiceId: "invoice", move, returnedQuantity: 1, description: "Paper", warehouse: "Main" }))
  expect(html).toContain("Original unit cost ฿125.00")
  expect(html).toContain("Main")
  expect(html).toMatch(/id="customer-return-delivery"[^>]*min="1" max="3" step="0.001" required=""[^>]*value="1"/)
})

it("provides an exact-baht unit cost entry for zero-stock counts", () => {
  const html = renderToStaticMarkup(createElement(CountForm, { products: [{ id: "product", name: "Paper", unit: "box" }], warehouses: [warehouse], balances: [], scope: "org/user" }))
  expect(html).toContain('for="count-unit-cost"')
  expect(html).toContain('min="0" step="0.01"')
  expect(html).toContain("Required when increasing stock from zero or below")
})

it("allows a service purchase return without requiring an active warehouse", () => {
  const line = { id: "line", purchase_order_id: "order", org_id: "org", product_id: null, description: "Service", quantity: 2, unit: "hour", unit_cost_satang: 100, received_quantity: 1, returned_quantity: 0, billed_quantity: 0, position: 0 }
  const html = renderToStaticMarkup(createElement(PurchaseReturnForm, { orderId: "order", lines: [line], warehouses: [] }))
  expect(html).toContain("Record vendor return")
  expect(html).not.toContain('id="return-warehouse"')
  const stockReturn = renderToStaticMarkup(createElement(PurchaseReturnForm, { orderId: "order", lines: [line], warehouses: [warehouse] }))
  expect(stockReturn).toContain('id="return-warehouse"')
})
