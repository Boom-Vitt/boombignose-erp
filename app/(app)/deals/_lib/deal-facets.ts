import type { Tables } from "@/lib/types/database"

/** The facet row for a deal, shared by the page and the CSV export so both filter alike. */
export function dealFacetRow(
  deal: Pick<Tables<"deals">, "title" | "stage" | "expected_close_date" | "owner">,
  client: string | undefined
) {
  return { text: `${deal.title} ${client ?? ""}`, status: deal.stage, date: deal.expected_close_date, owner: deal.owner }
}
