/**
 * PURE mapping from our internal invoice to a provider-neutral payload.
 *
 * DB-independent by design: it takes plain objects (whose field names mirror the
 * invoice row + its `clients(name)` embed) so a Supabase-loaded row drops in
 * without remapping, yet the function has no dependency on Supabase and is fully
 * unit-testable. See mapping.test.ts.
 *
 * Money note: our invoices store integer satang; providers expect whole baht, so
 * we convert via `satangToBaht` (satang / 100) exactly once, here.
 */
import { satangToBaht } from "@/lib/money"
import type { ExternalInvoicePayload } from "@/lib/accounting/provider"

/** The minimal shape of an invoice this mapper needs. Mirrors the DB row. */
export type InvoiceForMapping = {
  number: string
  amount_satang: number
  status: string
  issue_date: string | null
  due_date: string | null
}

/** The minimal shape of a client this mapper needs (the `clients(name)` embed). */
export type ClientForMapping = {
  name: string | null
}

/**
 * Map an invoice (+ optional client) to the neutral external payload.
 * `customerName` falls back to "Unknown" when the client is absent or unnamed.
 */
export function invoiceToExternalPayload(
  invoice: InvoiceForMapping,
  client?: ClientForMapping | null
): ExternalInvoicePayload {
  return {
    reference: invoice.number,
    customerName: client?.name?.trim() ? client.name : "Unknown",
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    currency: "THB",
    totalBaht: satangToBaht(invoice.amount_satang),
    status: invoice.status,
  }
}
