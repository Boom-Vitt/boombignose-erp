// PostgREST max_rows (supabase/config.toml): a full page means more rows may follow.
export const PAGE_ROWS = 1000

/**
 * Every row of a list query, read page by page past the API row cap. `page` must apply a unique
 * order and `.range(from, to)`. Any failed page fails the whole read, so totals are never partial.
 */
export async function readAll<T, E = unknown>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: E }>
): Promise<{ data: T[] | null; error: E | null }> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1)
    if (error || !data) return { data: null, error }
    rows.push(...data)
    if (data.length < PAGE_ROWS) return { data: rows, error: null }
  }
}
