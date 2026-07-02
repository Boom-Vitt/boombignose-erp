import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { renderDocumentHtml, type PrintableDocument } from "@/lib/documents/printable"

/**
 * GET /quotes/{id}/pdf
 * Org-scoped printable Quotation. Returns self-contained HTML the browser prints
 * to PDF (no binary PDF dependency). Quotes carry a valid-until date, no due date.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [quoteRes, itemsRes] = await Promise.all([
    supabase
      .from("quotes")
      .select(
        "number, status, issue_date, valid_until, subtotal_satang, discount_satang, total_satang, notes, clients(name)"
      )
      .eq("id", id)
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    supabase
      .from("quote_items")
      .select("description, quantity, unit_price_satang, amount_satang, position")
      .eq("quote_id", id)
      .eq("org_id", ctx.orgId)
      .order("position", { ascending: true }),
  ])

  const quote = quoteRes.data
  if (!quote) notFound()

  const doc: PrintableDocument = {
    kind: "Quotation",
    number: quote.number,
    status: quote.status,
    orgName: ctx.orgName,
    clientName: quote.clients?.name ?? "—",
    issueDate: quote.issue_date,
    dueDate: undefined,
    validUntil: quote.valid_until,
    items: (itemsRes.data ?? []).map((it) => ({
      description: it.description,
      quantity: it.quantity,
      unit_price_satang: it.unit_price_satang,
      amount_satang: it.amount_satang,
    })),
    subtotalSatang: quote.subtotal_satang,
    discountSatang: quote.discount_satang,
    totalSatang: quote.total_satang,
    notes: quote.notes,
  }

  return new Response(renderDocumentHtml(doc), {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
    },
  })
}
