import { expect, it } from "vitest"
import { renderRFQEmail } from "./rfq"
it("delivers all requested lines and exact amounts without requiring an internal link", () => {
  const html = renderRFQEmail({ number: "PO-2026-001", vendorName: "Supplier & Co", orderDate: "2026-10-24", expectedDate: "2026-10-30", notes: "Deliver <upstairs>", lines: [{ description: "<script>alert(1)</script>", quantity: 2.5, unit: "day & night", unit_cost_satang: 101 }] })
  expect(html).toContain("Request for quotation PO-2026-001")
  expect(html).toContain("Supplier &amp; Co")
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;")
  expect(html).toContain("2.5 day &amp; night")
  expect(html).toContain("฿2.53")
  expect(html).toContain("2026-10-30")
  expect(html).toContain("Deliver &lt;upstairs&gt;")
  expect(html).not.toContain("<script>")
  expect(html).not.toContain('href=')
})
