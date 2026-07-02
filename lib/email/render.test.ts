import { describe, it, expect } from "vitest"

import {
  renderInvoiceEmailHtml,
  renderQuoteEmailHtml,
  invoiceEmailSubject,
  quoteEmailSubject,
  escapeHtml,
} from "@/lib/email/render"

describe("escapeHtml", () => {
  it("escapes HTML-significant characters", () => {
    expect(escapeHtml(`<b>"A&B" 'x'</b>`)).toBe(
      "&lt;b&gt;&quot;A&amp;B&quot; &#39;x&#39;&lt;/b&gt;"
    )
  })
})

describe("renderInvoiceEmailHtml", () => {
  it("includes the number, formatted amount and PDF link", () => {
    const html = renderInvoiceEmailHtml({
      number: "INV-2026-001",
      clientName: "Acme Co",
      amountSatang: 123456,
      pdfUrl: "https://app.test/finance/invoices/1/pdf",
      dueDate: "2026-07-31",
    })
    expect(html).toContain("INV-2026-001")
    expect(html).toContain("Acme Co")
    expect(html).toContain("฿1,234.56")
    expect(html).toContain("https://app.test/finance/invoices/1/pdf")
    expect(html).toContain("2026-07-31")
  })

  it("falls back to a generic greeting and omits the due line when absent", () => {
    const html = renderInvoiceEmailHtml({
      number: "INV-1",
      clientName: null,
      amountSatang: 100,
      pdfUrl: "https://app.test/x/pdf",
    })
    expect(html).toContain("Hello,")
    expect(html).not.toContain("Payment is due")
  })

  it("escapes a malicious client name", () => {
    const html = renderInvoiceEmailHtml({
      number: "INV-1",
      clientName: "<script>evil</script>",
      amountSatang: 100,
      pdfUrl: "https://app.test/x/pdf",
    })
    expect(html).not.toContain("<script>evil</script>")
    expect(html).toContain("&lt;script&gt;")
  })
})

describe("renderQuoteEmailHtml", () => {
  it("includes the number, formatted total and PDF link", () => {
    const html = renderQuoteEmailHtml({
      number: "QUO-9",
      clientName: "Beta Ltd",
      totalSatang: 5000000,
      pdfUrl: "https://app.test/quotes/9/pdf",
      validUntil: "2026-08-15",
    })
    expect(html).toContain("QUO-9")
    expect(html).toContain("Beta Ltd")
    expect(html).toContain("฿50,000.00")
    expect(html).toContain("https://app.test/quotes/9/pdf")
    expect(html).toContain("2026-08-15")
  })
})

describe("subjects", () => {
  it("builds invoice and quote subjects", () => {
    expect(invoiceEmailSubject("INV-1")).toBe("Invoice INV-1")
    expect(quoteEmailSubject("QUO-1")).toBe("Quote QUO-1")
  })
})
