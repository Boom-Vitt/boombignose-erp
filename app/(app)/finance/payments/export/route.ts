import { readAll } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { receiptExportRows, RECEIPT_EXPORT_HEADERS } from "@/lib/documents/finance-export"

/** All retained evidence states are exported; only verified receipts are cash. */
export async function GET() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await readAll((from, to) => supabase.from("payments").select("id, invoice_id, verification_state, amount_satang, paid_at, verification_reference, method, reconciled_payment_id").eq("org_id", ctx.orgId).order("paid_at", { ascending: false }).order("id").range(from, to))
  if (error) return new Response("Receipt evidence export unavailable", { status: 503 })
  return new Response(toCsv(RECEIPT_EXPORT_HEADERS, receiptExportRows(data ?? [])), { headers: {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="receipt-evidence-${todayISO()}.csv"`,
  } })
}
