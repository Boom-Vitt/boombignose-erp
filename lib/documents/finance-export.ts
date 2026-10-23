import { satangToBahtString } from "@/lib/money"
import { deriveInvoiceStatus, outstandingSatang, type InvoiceStatus } from "@/lib/metrics/invoice-status"

export type ExportInvoice = {
  id: string; number: string; clientName: string; status: InvoiceStatus
  amount_satang: number; discount_satang: number; due_date: string | null; issue_date: string | null
  paid_satang: number; credited_satang?: number; source_quote_id: string | null; source_milestone_id: string | null
}
export type ExportReceipt = {
  id: string; invoice_id: string | null; verification_state: string; amount_satang: number
  paid_at: string; verification_reference: string | null; method: string
  reconciled_payment_id?: string | null
}
export const INVOICE_EXPORT_HEADERS = ["Invoice ID", "Number", "Client", "Stored status", "Effective status", "Amount (THB)", "Discount (THB)", "Verified receipts (THB)", "Outstanding (THB)", "Due date", "Issue date", "Source quote ID", "Source milestone ID", "Credit notes (THB)", "Net due (THB)"]
export const RECEIPT_EXPORT_HEADERS = ["Receipt ID", "Invoice ID", "Verification state", "Amount (THB)", "Recorded payment instant", "Evidence reference", "Method", "Reconciled receipt ID"]

export function invoiceExportRows(invoices: ExportInvoice[], today: string): string[][] {
  return invoices.map(invoice => {
    const paid = invoice.paid_satang
    const credited = invoice.credited_satang ?? 0
    return [invoice.id, invoice.number, invoice.clientName, invoice.status, deriveInvoiceStatus(invoice, paid, today), satangToBahtString(invoice.amount_satang), satangToBahtString(invoice.discount_satang), satangToBahtString(paid), satangToBahtString(outstandingSatang(invoice.amount_satang, paid, credited)), invoice.due_date ?? "", invoice.issue_date ?? "", invoice.source_quote_id ?? "", invoice.source_milestone_id ?? "", satangToBahtString(credited), satangToBahtString(invoice.amount_satang - credited)]
  })
}

/** Legacy rows remain traceable; their state makes exclusion from cash explicit. */
export function receiptExportRows(receipts: ExportReceipt[]): string[][] {
  return receipts.map(receipt => [receipt.id, receipt.invoice_id ?? "", receipt.verification_state, satangToBahtString(receipt.amount_satang), receipt.paid_at, receipt.verification_reference ?? "", receipt.method, receipt.reconciled_payment_id ?? ""])
}
