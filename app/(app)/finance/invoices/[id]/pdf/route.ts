import { readAll } from "@/lib/queries/read-all"
import { z } from "zod"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { invoiceSnapshotDocument } from "@/lib/documents/invoice-snapshot"
import { sumSatang } from "@/lib/money"
import { deriveInvoiceStatus, outstandingSatang } from "@/lib/metrics/invoice-status"
import { todayISO } from "@/lib/dates"
import { subtotalSatang } from "@/lib/metrics/line-items"
import {
  renderDocumentHtml,
  type DocLineItem,
  type PrintableDocument,
} from "@/lib/documents/printable"

/**
 * GET /finance/invoices/[id]/pdf
 * Serves a self-contained, print-to-PDF HTML document for one invoice. When the
 * invoice has line items they drive the table + subtotal; otherwise a single
 * synthetic line is derived from the invoice amount so the document is never
 * empty. The invoice amount_satang is collectible after WHT; total_satang is gross.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [invoiceRes, itemsRes, receiptsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "number, status, amount_satang, discount_satang, subtotal_satang, total_satang, vat_satang, wht_satang, wht_rate_bps, prices_include_vat, tax_breakdown, issued_snapshot_id, issue_date, due_date, notes, clients(name)"
      )
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    readAll((from, to) => supabase
      .from("invoice_items")
      .select("description, quantity, unit_price_satang, amount_satang, unit")
      .eq("invoice_id", id)
      .eq("org_id", ctx.orgId)
      .order("position", { ascending: true }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("payments").select("amount_satang").eq("org_id", ctx.orgId).eq("invoice_id", id).eq("verification_state", "verified").order("id").range(from, to)),
  ])

  if (invoiceRes.error || itemsRes.error || receiptsRes.error) return new Response("Invoice evidence unavailable", { status: 503 })
  const paid = sumSatang((receiptsRes.data ?? []).map(p => p.amount_satang))
  const invoice = invoiceRes.data
  if (!invoice) {
    return new Response("Invoice not found", { status: 404 })
  }

  const rows = itemsRes.data ?? []

  const items: DocLineItem[] =
    rows.length > 0
      ? rows.map((r) => ({
          description: r.description,
          quantity: r.quantity,
          unit: r.unit,
          unit_price_satang: r.unit_price_satang,
          amount_satang: r.amount_satang,
        }))
      : [
          {
            description: invoice.notes || "Services",
            quantity: 1,
            unit_price_satang: invoice.subtotal_satang ?? invoice.amount_satang + invoice.discount_satang,
            amount_satang: invoice.subtotal_satang ?? invoice.amount_satang + invoice.discount_satang,
          },
        ]

  let doc: PrintableDocument = {
    kind: "Invoice",
    number: invoice.number,
    status: deriveInvoiceStatus(invoice, paid, todayISO()),
    orgName: ctx.orgName,
    clientName: invoice.clients?.name ?? "—",
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    validUntil: undefined,
    items,
    subtotalSatang: invoice.subtotal_satang ?? subtotalSatang(items),
    discountSatang: invoice.discount_satang,
    totalSatang: invoice.total_satang ?? invoice.amount_satang,
    amountDueSatang: invoice.amount_satang,
    vatSatang: invoice.vat_satang ?? 0,
    whtSatang: invoice.wht_satang ?? 0,
    whtRateBps: invoice.wht_rate_bps ?? 0,
    pricesIncludeVat: invoice.prices_include_vat,
    vatByRate: z.array(z.object({ rateBps: z.number(), vatSatang: z.number() })).parse(invoice.tax_breakdown ?? []),
    verifiedPaidSatang: paid,
    outstandingSatang: outstandingSatang(invoice.amount_satang, paid),
    notes: invoice.notes,
  }

  if (invoice.issued_snapshot_id) {
    const snapshotRes = await supabase.from("invoice_snapshots").select("snapshot").eq("org_id", ctx.orgId).eq("invoice_id", id).eq("id", invoice.issued_snapshot_id).maybeSingle()
    if (snapshotRes.error || !snapshotRes.data) return new Response("Issued document unavailable", { status: 503 })
    try { doc = invoiceSnapshotDocument(snapshotRes.data.snapshot, deriveInvoiceStatus(invoice, paid, todayISO()), paid) }
    catch { return new Response("Issued document snapshot could not be validated", { status: 503 }) }
  }
  return new Response(renderDocumentHtml(doc), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
