import { expect, it } from "vitest"
import { invoiceSnapshotDocument } from "./invoice-snapshot"
const snapshot = {
  version: 1,
  seller: { legalName: "ร้านเดิม", address: "ที่อยู่เดิม", taxId: null, taxStatus: "unknown" },
  buyer: { id: "client", name: "ลูกค้าเดิม", address: "ที่อยู่ลูกค้า", taxId: null },
  document: { number: "INV-FROZEN", issueDate: "2026-01-01", dueDate: "2026-02-01", notes: "frozen", subtotalSatang: 10001, discountSatang: 1000, totalSatang: 9001 },
  lines: [{ description: "งานเดิม", quantity: 1, unitPriceSatang: 10001, amountSatang: 10001, position: 0 }],
}
it("renders the issued seller/buyer/amount from the snapshot and current verified balance separately", () => {
  const doc = invoiceSnapshotDocument(snapshot, "partially_paid", 1001)
  expect(doc.orgName).toBe("ร้านเดิม")
  expect(doc.clientName).toBe("ลูกค้าเดิม")
  expect(doc.discountSatang).toBe(1000)
  expect(doc.totalSatang).toBe(9001)
  expect(doc.outstandingSatang).toBe(8000)
  expect(doc.sellerAddress).toBe("ที่อยู่เดิม")
})
it("fails closed for unknown snapshot versions or corrupted unsafe totals", () => {
  expect(() => invoiceSnapshotDocument({ ...snapshot, version: 2 }, "sent", 0)).toThrow()
  expect(() => invoiceSnapshotDocument({ ...snapshot, document: { ...snapshot.document, totalSatang: Number.MAX_SAFE_INTEGER + 1 } }, "sent", 0)).toThrow()
  expect(() => invoiceSnapshotDocument({ ...snapshot, document: { ...snapshot.document, totalSatang: 9999 } }, "sent", 0)).toThrow()
})
