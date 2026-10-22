/** Each query must have a stable unique order. Stop only after a short page. */
export async function readAll<T>(query: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const data: T[] = []
  const size = 500
  for (let from = 0; ; from += size) {
    const result = await query(from, from + size - 1)
    if (result.error) return { data: [] as T[], error: result.error }
    const page = result.data ?? []
    data.push(...page)
    if (page.length < size) return { data, error: null }
  }
}
