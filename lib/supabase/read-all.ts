// PostgREST max_rows (supabase/config.toml): a full page means more rows may follow.
export const PAGE_ROWS = 1000

/**
 * Every row of a list query, read page by page past the API row cap. `page` must apply a unique
 * order and `.range(from, to)`. Any failed page fails the whole read, so totals are never partial.
 * Rows that carry an `id` are kept once.
 */
export async function readAll<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<{ data: T[] | null; error: unknown }> {
  const rows: T[] = []
  const seen = new Set<unknown>()
  for (let from = 0; ; from += PAGE_ROWS) {
    const { data, error } = await page(from, from + PAGE_ROWS - 1)
    if (error || !data) return { data: null, error }
    for (const row of data) {
      // An insert during the read shifts offsets and repeats a page-edge row.
      const id = (row as { id?: unknown } | null)?.id
      if (id !== undefined) {
        if (seen.has(id)) continue
        seen.add(id)
      }
      rows.push(row)
    }
    if (data.length < PAGE_ROWS) return { data: rows, error: null }
  }
}

/** `readAll` for callers that fail loudly: a failed page throws its error message. */
export async function readAllOrThrow<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const { data, error } = await readAll(page)
  if (!data) throw new Error((error as { message?: string } | null)?.message ?? "Read failed")
  return data
}
