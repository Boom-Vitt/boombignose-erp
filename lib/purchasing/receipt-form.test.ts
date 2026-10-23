import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import type { Tables } from "@/lib/types/database"
vi.mock("@/app/(app)/purchases/actions", () => ({ receivePurchase: vi.fn(), returnPurchase: vi.fn() }))
import { ReceiptForm } from "@/app/(app)/purchases/_components/receipt-form"

it("renders retained over-receipts at or above their native input minimum", () => {
  const line = { id: "line", description: "Already received", received_quantity: 6.6, quantity: 6, unit: "piece" } as Tables<"purchase_order_items">
  const html = renderToStaticMarkup(createElement(ReceiptForm, { orderId: "po", lines: [line], tolerancePercent: 0 }))
  expect(html).toContain('min="6.6"')
  expect(html).toContain('value="6.6"')
})
