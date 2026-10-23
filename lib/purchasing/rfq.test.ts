import { expect, it } from "vitest"
import { renderRFQEmail } from "./rfq"
import { RFQClaim } from "./schema"
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

it("delivers frozen grid sections and notes in display order without adding them to totals", () => {
  const claim = RFQClaim.parse({
    delivery_key: "b6000000-0000-4000-8000-000000000030",
    snapshot: {
      to: "supplier@example.invalid", number: "PO-1", vendorName: "Supplier", orderDate: "2026-10-23", expectedDate: null, notes: null,
      lines: [
        { description: "First product", quantity: 2.5, unit: "piece", unit_cost_satang: 101 },
        { description: "Second product", quantity: 1, unit: "piece", unit_cost_satang: 200 },
      ],
      sections: [
        { id: "b6000000-0000-4000-8000-000000000033", kind: "note", description: "Trailing <script>terms</script>", lines_before: 2, position: 2 },
        { id: "b6000000-0000-4000-8000-000000000031", kind: "section", description: "Frozen & agreed", lines_before: 0, position: 0 },
        { id: "b6000000-0000-4000-8000-000000000032", kind: "note", description: "Before <delivery>", lines_before: 1, position: 1 },
      ],
    },
  })
  const html = renderRFQEmail(claim.snapshot)
  const ordered = ["Frozen &amp; agreed", "First product", "Before &lt;delivery&gt;", "Second product", "Trailing &lt;script&gt;terms&lt;/script&gt;"]
  for (const value of ordered) expect(html).toContain(value)
  expect(ordered.map(value => html.indexOf(value))).toEqual(ordered.map(value => html.indexOf(value)).sort((a, b) => a - b))
  expect(html).toContain('colspan="4"')
  expect(html).toContain("Total: <strong>฿4.53</strong>")
  expect(html).not.toContain("<script>")
})
