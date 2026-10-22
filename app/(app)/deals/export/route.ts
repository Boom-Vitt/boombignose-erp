import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { toCsv } from "@/lib/export/csv"
import { todayISO } from "@/lib/dates"
import { matchesFacets, parseFacets } from "@/lib/search-facets"
import { fetchAllRows } from "@/lib/queries/fetch-all-rows"
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
  const deals = (await fetchAllRows(() => supabase
    .from("deals")
    .select(
      "title, stage, value_satang, owner, expected_close_date, next_follow_up_date, client:clients(name)"
    )
    .eq("org_id", ctx.orgId)
    .order("created_at", { ascending: false })
    .order("id"))
  ).filter((d) => matchesFacets(config, dealFacetRow(d, d.client?.name), ctx.userId, now))

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
    d.client?.name ?? "",
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
