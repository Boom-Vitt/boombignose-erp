import { describe, expect, it } from "vitest"
import { renderWhtCertificate, type WhtCertificateDraft } from "@/lib/tax/wht-certificate"

const draft: WhtCertificateDraft = {
  reference: "INV-2026-000001",
  issueDate: "2026-10-28",
  payerName: "ผู้ซื้อ",
  payerAddress: "ที่อยู่ผู้ซื้อ",
  payerTaxId: "1111111111111",
  payeeName: "ผู้ขาย",
  payeeAddress: "ที่อยู่ผู้ขาย",
  payeeTaxId: "2222222222222",
  income: "ค่าบริการ",
  baseSatang: 100000,
  whtSatang: 3000,
  whtRateBps: 300,
}

describe("renderWhtCertificate", () => {
  it("prints a draft 50 ทวิ from the operational invoice", () => {
    const html = renderWhtCertificate(draft)
    expect(html).toContain("DRAFT")
    expect(html).toContain("ไม่ใช่แบบของกรมสรรพากร")
    expect(html).toContain("50 ทวิ")
    expect(html).toContain("INV-2026-000001")
    expect(html).toContain("2026-10-28 (28/10/2569)")
    expect(html).toContain("ผู้ซื้อ")
    expect(html).toContain("ผู้ขาย")
    expect(html).toContain("3%")
    expect(html).toContain("1,000.00")
    expect(html).toContain("30.00")
  })

  it("escapes payer and income text", () => {
    const html = renderWhtCertificate({ ...draft, payerName: `<script>alert("x")</script>`, income: `a & b` })
    expect(html).not.toContain("<script>")
    expect(html).toContain("&lt;script&gt;")
    expect(html).toContain("a &amp; b")
  })

  it("refuses a document that withheld nothing", () => {
    expect(() => renderWhtCertificate({ ...draft, whtSatang: 0 })).toThrow("No withholding to certify")
  })
})
