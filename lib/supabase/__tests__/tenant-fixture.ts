/** A small PostgREST result fixture; filtering changes the rows observed by real pages. */
export function databaseFixture(tables: Record<string, Record<string, unknown>[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      let single = false
      let countDeals = false
      let embedClient = false
      const dealFilters: [string, readonly unknown[]][] = []
      const query = {
        select: (columns = '') => {
          countDeals = columns.includes('deals(count)')
          embedClient = columns.includes('client:clients(')
          return query
        },
        insert: (row: Record<string, unknown>) => {
          (tables[table] ??= []).push(row)
          rows = [row]
          return query
        },
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value)
          return query
        },
        in: (key: string, values: readonly unknown[]) => {
          if (key.startsWith('deals.')) {
            dealFilters.push([key.slice('deals.'.length), values])
            return query
          }
          rows = rows.filter((row) => values.includes(row[key]))
          return query
        },
        not: (key: string, operator: string, value: unknown) => {
          if (operator === 'is' && value === null) rows = rows.filter((row) => row[key] != null)
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
          const text = value.replace(/^%|%$/g, '').replace(/\\(.)/g, '$1').toLowerCase()
          rows = rows.filter((row) => String(row[key]).toLowerCase().includes(text))
          return query
        },
        order: () => query,
        limit: (value: number) => { rows = rows.slice(0, value); return query },
        range: (from: number, to: number) => { rows = rows.slice(from, to + 1); return query },
        maybeSingle: () => { single = true; return query },
        then: (resolve: (result: unknown) => unknown, reject?: (error: unknown) => unknown) => {
          const data = countDeals ? rows.map((row) => ({
            ...row,
            deals: [{ count: (tables.deals ?? []).filter((deal) =>
              deal.org_id === row.org_id && deal.client_id === row.id &&
              dealFilters.every(([key, values]) => values.includes(deal[key]))
            ).length }],
          })) : embedClient ? rows.map((row) => ({
            ...row,
            client: (tables.clients ?? []).find((client) => client.id === row.client_id) ?? null,
          })) : rows
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject)
        },
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
