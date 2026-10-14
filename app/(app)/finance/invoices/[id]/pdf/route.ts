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
 * empty. The invoice's authoritative `amount_satang` is always the grand total.
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
        "number, status, amount_satang, discount_satang, issued_snapshot_id, issue_date, due_date, notes, clients(name)"
      )
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    supabase
      .from("invoice_items")
      .select("description, quantity, unit_price_satang, amount_satang")
      .eq("invoice_id", id)
      .eq("org_id", ctx.orgId)
      .order("position", { ascending: true }),
    supabase.from("payments").select("amount_satang").eq("org_id", ctx.orgId).eq("invoice_id", id).eq("verification_state", "verified"),
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
          unit_price_satang: r.unit_price_satang,
          amount_satang: r.amount_satang,
        }))
      : [
          {
            description: invoice.notes || "Services",
            quantity: 1,
            unit_price_satang: invoice.amount_satang,
            amount_satang: invoice.amount_satang,
          },
        ]

  let doc: PrintableDocument = {
    kind: invoice.status === "draft" ? "ร่างใบแจ้งหนี้ / Draft invoice" : "รายการเดิม / Legacy operational record",
    number: invoice.number,
    status: deriveInvoiceStatus(invoice, paid, todayISO()),
    orgName: ctx.orgName,
    clientName: invoice.clients?.name ?? "—",
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    validUntil: undefined,
    items,
    subtotalSatang: subtotalSatang(items),
    discountSatang: invoice.discount_satang,
    totalSatang: invoice.amount_satang,
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
