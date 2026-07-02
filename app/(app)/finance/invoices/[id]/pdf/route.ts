import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
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

  const [invoiceRes, itemsRes] = await Promise.all([
    supabase
      .from("invoices")
      .select(
        "number, status, amount_satang, issue_date, due_date, notes, clients(name)"
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
  ])

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

  const doc: PrintableDocument = {
    kind: "Invoice",
    number: invoice.number,
    status: invoice.status,
    orgName: ctx.orgName,
    clientName: invoice.clients?.name ?? "—",
    issueDate: invoice.issue_date,
    dueDate: invoice.due_date,
    validUntil: undefined,
    items,
    subtotalSatang: subtotalSatang(items),
    totalSatang: invoice.amount_satang,
    notes: invoice.notes,
  }

  return new Response(renderDocumentHtml(doc), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}
