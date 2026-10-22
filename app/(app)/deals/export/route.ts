import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { expectedRevenue } from "@/lib/metrics/pipeline"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { matchesFacets, parseFacets } from "@/lib/search-facets"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { dealFacetRow } from "../_lib/deal-facets"

/**
 * GET /deals/export[?status=…&q=…&period=…&mine=1]
 * Org-scoped deal export. Value column is baht (satang ÷ 100). Filters are the
 * Deals page facets (legacy `stage` included), so an export from a filtered
 * view contains exactly the visible deals.
 */
export async function GET(request: Request) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const config = parseFacets(new URL(request.url).searchParams, "deals")

  const now = new Date()
  const deals = (await readAllOrThrow((from, to) => supabase
    .from("deals")
    .select(
      "id, title, stage, value_satang, probability, won_at, lost_at, owner, expected_close_date, next_follow_up_date, client:clients(name), lost_reason:deal_lost_reasons(name)"
    )
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .order("id")
    .range(from, to))
  ).filter((d) => matchesFacets(config, dealFacetRow(d, d.client?.name), ctx.userId, now))

  const headers = [
    "Title",
    "Client",
    "Stage",
    "Value (THB)",
    "Probability (%)",
    "Expected revenue (THB)",
    "Expected close",
    "Next follow-up",
    "Won at",
    "Lost at",
    "Lost reason",
  ]
  const rows = deals.map((d) => [
    d.title,
    d.client?.name ?? "",
    d.stage,
    satangToBaht(d.value_satang),
    d.probability,
    satangToBaht(expectedRevenue(d)),
    d.expected_close_date ?? "",
    d.next_follow_up_date ?? "",
    d.won_at ?? "",
    d.lost_at ?? "",
    d.lost_reason?.name ?? "",
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
