import { invoiceBalances } from "@/lib/payments/balances"
import { readAll } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { facetValues, parseFacets } from "@/lib/search-facets"
import { invoiceExportRows, INVOICE_EXPORT_HEADERS } from "@/lib/documents/finance-export"

/** Operational receivables: exact THB strings, verified receipts and source IDs. */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()
  const statuses = facetValues(parseFacets(new URL(request.url).searchParams, "finance").status)
  const [invoicesRes, receiptsRes] = await Promise.all([
    readAll((from, to) => supabase.from("invoices").select("id, number, amount_satang, discount_satang, status, due_date, issue_date, source_quote_id, source_milestone_id, clients(name)").eq("org_id", ctx.orgId).order("issue_date", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase.from("invoice_receipts").select("id, invoice_id, verification_state, amount_satang, paid_at, verification_reference, method").eq("org_id", ctx.orgId).eq("verification_state", "verified").order("id").range(from, to)),
  ])
  if (invoicesRes.error || receiptsRes.error) return new Response("Receivables export unavailable", { status: 503 })
  const balances = await invoiceBalances(supabase, ctx.orgId)
  let rows = invoiceExportRows((invoicesRes.data ?? []).map(invoice => ({ ...invoice, credited_satang: balances.get(invoice.id)?.credited_satang ?? 0, clientName: invoice.clients?.name ?? "" })), receiptsRes.data ?? [], today)
  if (statuses.length) rows = rows.filter(row => statuses.includes(row[4]))
  return new Response(toCsv(INVOICE_EXPORT_HEADERS, rows), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="invoices-${today}.csv"`,
  } })
}
