import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { Constants } from "@/lib/types/database"

const DEAL_STAGES = Constants.public.Enums.deal_stage

/**
 * GET /deals/export[?stage=…&q=…]
 * Org-scoped deal export. Value column is baht (satang ÷ 100). Filters mirror the
 * Deals page: `stage` (exact) and `q` (case-insensitive title search), so an
 * export from a filtered view contains exactly the visible deals.
 */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const params = new URL(request.url).searchParams
  const stage = params.get("stage") ?? ""
  const q = (params.get("q") ?? "").trim()
  const stageFilter = (DEAL_STAGES as readonly string[]).includes(stage)
    ? stage
    : null

  const [dealsRes, clientsRes] = await Promise.all([
    (() => {
      let query = supabase
        .from("deals")
        .select(
          "title, stage, value_satang, client_id, expected_close_date, next_follow_up_date"
        )
        .eq("org_id", ctx.orgId)
        .order("created_at", { ascending: false })
      if (stageFilter) {
        query = query.eq("stage", stageFilter as (typeof DEAL_STAGES)[number])
      }
      if (q) query = query.ilike("title", `%${q}%`)
      return query
    })(),
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId),
  ])

  const deals = dealsRes.data ?? []
  const clientName = new Map((clientsRes.data ?? []).map((c) => [c.id, c.name]))

  const headers = [
    "Title",
    "Client",
    "Stage",
    "Value (THB)",
    "Expected close",
    "Next follow-up",
  ]
  const rows = deals.map((d) => [
    d.title,
    clientName.get(d.client_id) ?? "",
    d.stage,
    satangToBaht(d.value_satang),
    d.expected_close_date ?? "",
    d.next_follow_up_date ?? "",
  ])

  const csv = toCsv(headers, rows)
  const filename = `deals-${todayISO()}.csv`

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  })
}
