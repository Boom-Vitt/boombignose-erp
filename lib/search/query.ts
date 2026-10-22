/** Records the command palette searches, in display order, with the columns matched by name or number. */
export const SEARCH_SOURCES = [
  { type: "client", label: "Client", table: "clients", columns: ["name"] },
  { type: "deal", label: "Deal", table: "deals", columns: ["title"] },
  { type: "quote", label: "Quote", table: "quotes", columns: ["number"] },
  { type: "invoice", label: "Invoice", table: "invoices", columns: ["number"] },
  { type: "project", label: "Project", table: "projects", columns: ["name"] },
  { type: "product", label: "Product", table: "products", columns: ["name", "sku"] },
] as const

export type SearchSource = (typeof SEARCH_SOURCES)[number]
export type SearchType = SearchSource["type"]

export const SEARCH_LIMIT = 5
export const MIN_TERM = 2
export const MAX_TERM = 100

/** The term to search for, or null when the input is too short to be worth a query. */
export function searchTerm(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const term = raw.replace(/\s+/g, " ").trim().slice(0, MAX_TERM)
  return term.length >= MIN_TERM ? term : null
}

/** ILIKE pattern that matches `term` anywhere, with `%`, `_` and `\` taken literally. */
export function containsPattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, "\\$&")}%`
}

/** PostgREST `or` filter; the quoted value keeps commas, dots and parentheses in the term literal. */
export function orFilter(columns: readonly string[], term: string): string {
  const value = JSON.stringify(containsPattern(term))
  return columns.map((column) => `${column}.ilike.${value}`).join(",")
}

/** One query per searchable record type, or none when the term is too short. */
export function searchQueries(raw: unknown) {
  const term = searchTerm(raw)
  if (!term) return []
  return SEARCH_SOURCES.map((source) => ({
    ...source,
    filter: orFilter(source.columns, term),
    limit: SEARCH_LIMIT,
  }))
}
