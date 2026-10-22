// Must not exceed `max_rows` in supabase/config.toml, or a capped page would look like the last one.
const PAGE = 1000

/**
 * Every row of a list query, paged past the API's row cap so counts, totals and
 * filters see the whole set. `query` builds a fresh query with a total order.
 */
export async function fetchAllRows<T extends { id: string }>(
  query: () => { range(from: number, to: number): PromiseLike<{ data: T[] | null; error: unknown }> }
): Promise<T[]> {
  // Keyed by id: an insert while paging shifts offsets and repeats a page-edge row.
  const rows = new Map<string, T>()
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query().range(from, from + PAGE - 1)
    if (error) throw error
    for (const row of data ?? []) rows.set(row.id, row)
    if ((data?.length ?? 0) < PAGE) return [...rows.values()]
  }
}
