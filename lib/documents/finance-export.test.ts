import { expect, it } from "vitest"
import { invoiceExportRows, receiptExportRows } from "./finance-export"

it("exports exact discounted totals and verified-only receipt balances", () => {
  const invoices = [{ id: "invoice", number: "INV", clientName: "ลูกค้า", status: "sent" as const, amount_satang: 9001, paid_satang: 1001, credited_satang: 1000, discount_satang: 1000, due_date: "2026-01-01", issue_date: "2025-12-01", source_quote_id: "quote", source_milestone_id: "milestone" }]
  const receipts = [
    { id: "trusted", invoice_id: "invoice", verification_state: "verified", amount_satang: 1001, paid_at: "2026-01-02", verification_reference: "bank", method: "transfer" },
    { id: "legacy", invoice_id: "invoice", verification_state: "legacy_unverified", amount_satang: 8000, paid_at: "2026-01-02", verification_reference: "old", method: "transfer", reconciled_payment_id: "trusted" },
  ]
  expect(invoiceExportRows(invoices, "2026-01-03")[0]).toEqual([
    "invoice", "INV", "ลูกค้า", "sent", "overdue", "90.01", "10.00", "10.01", "70.00", "2026-01-01", "2025-12-01", "quote", "milestone", "10.00", "80.01",
  ])
  expect(receiptExportRows(receipts)[1]).toContain("legacy_unverified")
  expect(receiptExportRows(receipts)[1]).toContain("80.00")
  expect(receiptExportRows(receipts)[1][7]).toBe("trusted")
})

it("never drops the final satang in an accountant export at safe bounds", () => {
  const rows = invoiceExportRows([{ id: "i", number: "N", clientName: "C", status: "draft", amount_satang: Number.MAX_SAFE_INTEGER, paid_satang: 0, discount_satang: 0, due_date: null, issue_date: null, source_quote_id: null, source_milestone_id: null }], "2026-01-01")
  expect(rows[0][5]).toBe("90071992547409.91")
})
