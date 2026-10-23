import { z } from "zod"
import type { PrintableDocument } from "./printable"

const money = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const CreditSnapshot = z.object({
  version: z.literal(1), kind: z.literal("credit_note"), originalNumber: z.string(),
  seller: z.object({ legalName: z.string(), address: z.string(), taxId: z.string().nullable(), vatRegistered: z.boolean(), branchLabel: z.string().nullable().optional() }),
  buyer: z.object({ name: z.string(), address: z.string().nullable(), taxId: z.string().nullable(), branchLabel: z.string().nullable().optional() }),
  document: z.object({ number: z.string(), issueDate: z.string(), reason: z.string(), baseSatang: money, vatSatang: money, totalSatang: money, whtSatang: money, amountDueSatang: money, pricesIncludeVat: z.boolean(), whtRateBps: z.number(), vatByRate: z.array(z.object({ rateBps: z.number(), baseSatang: money, vatSatang: money })) }),
  lines: z.array(z.object({ description: z.string(), quantity: z.number().positive(), unit: z.string().nullable(), unitPriceSatang: money, amountSatang: money })),
})

export function creditNoteDocument(value: unknown): PrintableDocument {
  const { seller, buyer, document: d, lines, originalNumber } = CreditSnapshot.parse(value)
  if (d.totalSatang !== d.baseSatang + d.vatSatang || d.amountDueSatang !== d.totalSatang - d.whtSatang || d.vatByRate.reduce((sum, bucket) => sum + bucket.vatSatang, 0) !== d.vatSatang) throw new Error("Invalid credit totals")
  const subtotal = lines.reduce((sum, line) => sum + line.amountSatang, 0)
  return { kind: seller.vatRegistered ? "Tax credit note / ใบลดหนี้" : "Credit note / ใบลดหนี้", number: d.number, status: "issued", orgName: seller.legalName, sellerAddress: seller.address, sellerTaxId: seller.taxId, sellerBranch: seller.branchLabel,
    clientName: buyer.name, buyerAddress: buyer.address, buyerTaxId: buyer.taxId, buyerBranch: buyer.branchLabel,
    issueDate: d.issueDate, originalNumber, notes: d.reason, items: lines.map(line => ({ description: line.description, quantity: line.quantity, unit: line.unit, unit_price_satang: line.unitPriceSatang, amount_satang: line.amountSatang })),
    subtotalSatang: subtotal, discountSatang: subtotal - d.baseSatang - (d.pricesIncludeVat ? d.vatSatang : 0), totalSatang: d.totalSatang, vatSatang: d.vatSatang, vatByRate: d.vatByRate, whtSatang: d.whtSatang, whtRateBps: d.whtRateBps, amountDueSatang: d.amountDueSatang, pricesIncludeVat: d.pricesIncludeVat }
}
