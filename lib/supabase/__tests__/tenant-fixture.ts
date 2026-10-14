/** A small PostgREST result fixture; filtering changes the rows observed by real pages. */
export function databaseFixture(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      let single = false
      const query = {
        select: () => query,
        insert: (row: Record<string, unknown>) => {
          (tables[table] ??= []).push(row)
          rows = [row]
          return query
        },
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value)
          return query
        },
        in: (key: string, values: unknown[]) => {
          rows = rows.filter((row) => values.includes(row[key]))
          return query
        },
        gte: (key: string, value: string) => {
          rows = rows.filter((row) => String(row[key]) >= value)
          return query
        },
        lt: (key: string, value: string) => {
          rows = rows.filter((row) => String(row[key]) < value)
          return query
        },
        ilike: (key: string, value: string) => {
          rows = rows.filter((row) => String(row[key]).toLowerCase().includes(value.replaceAll('%', '').toLowerCase()))
          return query
        },
        order: () => query,
        limit: (value: number) => { rows = rows.slice(0, value); return query },
        maybeSingle: () => { single = true; return query },
        then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) =>
          Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve, reject),
      }
      return query
    },
  }
}

export function pageContent(value: unknown): string {
  if (value == null || typeof value === 'boolean') return ''
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(pageContent).join(' ')
  if (typeof value === 'object') {
    if ('props' in value) return pageContent(value.props)
    return Object.values(value).map(pageContent).join(' ')
  }
  return ''
}
