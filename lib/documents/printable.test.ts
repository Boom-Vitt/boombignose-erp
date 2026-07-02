import { describe, it, expect } from "vitest"

import { escapeHtml, renderDocumentHtml, type PrintableDocument } from "./printable"

describe("escapeHtml", () => {
  it("escapes the html-significant characters", () => {
    expect(escapeHtml(`<b>a&b "c" 'd'</b>`)).toBe(
      "&lt;b&gt;a&amp;b &quot;c&quot; &#39;d&#39;&lt;/b&gt;"
    )
  })
})

const doc: PrintableDocument = {
  kind: "Invoice",
  number: "INV-2026-001",
  status: "sent",
  orgName: "BoomBigNose",
  clientName: "Acme Co",
  issueDate: "2026-07-01",
  dueDate: "2026-07-31",
  items: [
    { description: "Design", quantity: 2, unit_price_satang: 50000, amount_satang: 100000 },
  ],
  subtotalSatang: 100000,
  discountSatang: 10000,
  totalSatang: 90000,
  notes: "Thanks!",
}

describe("renderDocumentHtml", () => {
  it("renders a full standalone html document", () => {
    const html = renderDocumentHtml(doc)
    expect(html.startsWith("<!doctype html>")).toBe(true)
    expect(html).toContain("INV-2026-001")
    expect(html).toContain("Acme Co")
    expect(html).toContain("Design")
    expect(html).toContain("Discount")
  })

  it("escapes untrusted field values", () => {
    const html = renderDocumentHtml({
      ...doc,
      clientName: `<script>alert(1)</script>`,
    })
    expect(html).not.toContain("<script>alert(1)</script>")
    expect(html).toContain("&lt;script&gt;")
  })

  it("omits the discount line when there is no discount", () => {
    const html = renderDocumentHtml({ ...doc, discountSatang: 0 })
    expect(html).not.toContain("Discount")
  })

  it("shows an empty-state row when there are no items", () => {
    const html = renderDocumentHtml({ ...doc, items: [] })
    expect(html).toContain("No line items.")
  })
})
