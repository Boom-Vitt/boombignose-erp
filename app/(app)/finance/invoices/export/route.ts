import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { Constants } from "@/lib/types/database"

const INVOICE_STATUSES = Constants.public.Enums.invoice_status

/**
 * GET /finance/invoices/export[?status=…]
 * Org-scoped invoice export. Money columns are baht (satang ÷ 100), not satang,
 * so spreadsheets parse them as numbers. `status` filters on the stored column
 * (mirrors the Finance page filter), keeping the query simple — no payments join.
 */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const status = new URL(request.url).searchParams.get("status") ?? ""
  const statusFilter = (
    INVOICE_STATUSES as readonly string[]
  ).includes(status)
    ? status
    : null

  let query = supabase
    .from("invoices")
    .select(
      "number, amount_satang, status, due_date, issue_date, clients(name)"
    )
    .eq("org_id", ctx.orgId)
    .order("issue_date", { ascending: false })

  if (statusFilter) {
    query = query.eq(
      "status",
      statusFilter as (typeof INVOICE_STATUSES)[number]
    )
  }

  const { data } = await query
  const invoices = data ?? []

  const headers = [
    "Number",
    "Client",
    "Status",
    "Amount (THB)",
    "Due date",
    "Created",
  ]
  const rows = invoices.map((inv) => [
    inv.number,
    inv.clients?.name ?? "",
    inv.status,
    satangToBaht(inv.amount_satang),
    inv.due_date ?? "",
    inv.issue_date ?? "",
  ])

  const csv = toCsv(headers, rows)
  const filename = `invoices-${todayISO()}.csv`

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
