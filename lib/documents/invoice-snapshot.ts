import { z } from "zod"
import { sumSatang } from "@/lib/money"
import { outstandingSatang } from "@/lib/metrics/invoice-status"
import type { PrintableDocument } from "./printable"

const satang = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const InvoiceSnapshot = z.object({
  version: z.literal(1),
  seller: z.object({ legalName: z.string().min(1), address: z.string(), taxId: z.string().nullable(), taxStatus: z.enum(["unknown", "not_registered", "registered"]) }),
  buyer: z.object({ id: z.string(), name: z.string(), address: z.string().nullable(), taxId: z.string().nullable() }),
  document: z.object({ number: z.string(), issueDate: z.string().nullable(), dueDate: z.string().nullable(), notes: z.string().nullable(), subtotalSatang: satang, discountSatang: satang, totalSatang: satang }),
  lines: z.array(z.object({ description: z.string(), quantity: z.number().positive().max(999999999.999), unit: z.string().nullable().optional(), unitPriceSatang: satang, amountSatang: satang, position: z.number().int().min(0) })).min(1),
})

/** Read the immutable issued content, never substitute the customer's live profile. */
export function invoiceSnapshotDocument(value: unknown, status: string, verifiedPaidSatang: number): PrintableDocument {
  const snapshot = InvoiceSnapshot.parse(value)
  const document = snapshot.document
  if (sumSatang(snapshot.lines.map(line => line.amountSatang)) !== document.subtotalSatang || document.discountSatang > document.subtotalSatang || document.subtotalSatang - document.discountSatang !== document.totalSatang) throw new Error("Invalid issued snapshot totals")
  return {
    kind: "ใบแจ้งหนี้ / Operational invoice", number: document.number, status,
    orgName: snapshot.seller.legalName, sellerAddress: snapshot.seller.address, sellerTaxId: snapshot.seller.taxId,
    clientName: snapshot.buyer.name, buyerAddress: snapshot.buyer.address, buyerTaxId: snapshot.buyer.taxId,
    issueDate: document.issueDate, dueDate: document.dueDate, notes: document.notes,
    items: snapshot.lines.map(line => ({ description: line.description, quantity: line.quantity, unit: line.unit, unit_price_satang: line.unitPriceSatang, amount_satang: line.amountSatang })),
    subtotalSatang: document.subtotalSatang, discountSatang: document.discountSatang, totalSatang: document.totalSatang,
    verifiedPaidSatang, outstandingSatang: outstandingSatang(document.totalSatang, verifiedPaidSatang),
  }
}
