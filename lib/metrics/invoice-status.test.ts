import { describe, it, expect } from "vitest"

import {
  deriveInvoiceStatus,
  outstandingSatang,
  type InvoiceForStatus,
} from "@/lib/metrics/invoice-status"

const TODAY = "2026-06-30"

function inv(partial: Partial<InvoiceForStatus>): InvoiceForStatus {
  return { status: "sent", amount_satang: 100_000, due_date: null, ...partial }
}

describe("deriveInvoiceStatus", () => {
  it("leaves draft and cancelled untouched", () => {
    expect(deriveInvoiceStatus(inv({ status: "draft" }), 100_000, TODAY)).toBe("draft")
    expect(deriveInvoiceStatus(inv({ status: "cancelled" }), 0, TODAY)).toBe("cancelled")
  })

  it("marks fully paid invoices as paid", () => {
    expect(deriveInvoiceStatus(inv({ amount_satang: 100_000 }), 100_000, TODAY)).toBe("paid")
    expect(deriveInvoiceStatus(inv({ amount_satang: 100_000 }), 150_000, TODAY)).toBe("paid")
  })

  it("marks past-due unpaid invoices as overdue", () => {
    expect(deriveInvoiceStatus(inv({ due_date: "2026-06-01" }), 0, TODAY)).toBe("overdue")
  })

  it("treats a past-due partially-paid invoice as overdue", () => {
    expect(
      deriveInvoiceStatus(inv({ amount_satang: 100_000, due_date: "2026-06-01" }), 40_000, TODAY)
    ).toBe("overdue")
  })

  it("marks partial payment when not past due", () => {
    expect(
      deriveInvoiceStatus(inv({ amount_satang: 100_000, due_date: "2026-07-30" }), 40_000, TODAY)
    ).toBe("partially_paid")
  })

  it("keeps 'sent' when nothing is paid and not past due", () => {
    expect(deriveInvoiceStatus(inv({ due_date: "2026-07-30" }), 0, TODAY)).toBe("sent")
  })

  it("does not flip a zero-amount invoice to paid on a zero payment", () => {
    expect(deriveInvoiceStatus(inv({ amount_satang: 0, due_date: null }), 0, TODAY)).toBe("sent")
  })
})

describe("outstandingSatang", () => {
  it("is the remaining balance, never negative", () => {
    expect(outstandingSatang(100_000, 40_000)).toBe(60_000)
    expect(outstandingSatang(100_000, 120_000)).toBe(0)
    expect(outstandingSatang(100_000, 0)).toBe(100_000)
  })
})
