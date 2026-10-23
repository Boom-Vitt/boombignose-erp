import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBahtString } from "@/lib/money"
import { toCsv } from "@/lib/export/csv"
import { readAll } from "@/lib/supabase/read-all"
import { todayISO } from "@/lib/dates"

/**
 * GET /finance/costs/export
 * Org-scoped operating-cost export. Amount column is baht (satang ÷ 100).
 */
export async function GET() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const { data, error } = await readAll((from, to) => supabase
    .from("costs")
    .select("category, vendor, notes, amount_satang, incurred_on, vendor_invoice_reference, bill_date, input_vat_rate, input_vat_satang")
    .eq("org_id", ctx.orgId)
    .order("incurred_on", { ascending: false }).order("id").range(from, to))

  if (error) return new Response("Cost export unavailable", { status: 503 })
  const costs = data ?? []

  const headers = ["Category", "Vendor / description", "Amount (THB)", "Date", "Vendor invoice reference", "Bill date", "Input VAT rate (%)", "Input VAT (THB)"]
  const rows = costs.map((c) => [
    c.category,
    c.vendor ?? c.notes ?? "",
    satangToBahtString(c.amount_satang),
    c.incurred_on,
    c.vendor_invoice_reference ?? "",
    c.bill_date ?? "",
    String(c.input_vat_rate),
    satangToBahtString(c.input_vat_satang),
  ])

  const csv = toCsv(headers, rows)
  const filename = `costs-${todayISO()}.csv`

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
