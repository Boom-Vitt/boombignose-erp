import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ client: {} as unknown, ctx: { orgId: "A", userId: "me", role: "owner" } }))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => state.ctx }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
import { myActivities, myActivityCounts, recordHistory, recordTimelinePage } from "./queries"

type Row = Record<string, unknown>
function databaseFixture(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      let rows = [...(tables[table] ?? [])]
      let start = 0
      let end = 999
      let countOnly = false
      const orders: { key: string; ascending: boolean; nullsFirst: boolean }[] = []
      const query = {
        select: (_columns = "*", options?: { head?: boolean; count?: string }) => { countOnly = options?.head === true; return query },
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query },
        lt: (key: string, value: string) => { rows = rows.filter(row => row[key] != null && String(row[key]) < value); return query },
        lte: (key: string, value: string) => { rows = rows.filter(row => row[key] != null && String(row[key]) <= value); return query },
        gt: (key: string, value: string) => { rows = rows.filter(row => row[key] != null && String(row[key]) > value); return query },
        order: (key: string, options: { ascending?: boolean; nullsFirst?: boolean } = {}) => { orders.push({ key, ascending: options.ascending ?? true, nullsFirst: options.nullsFirst ?? false }); return query },
        range: (from: number, to: number) => { start = from; end = to; return query },
        limit: (limit: number) => { end = start + limit - 1; return query },
        or: (expression: string) => {
          const match = expression.match(/^(\w+)\.lt\.([^,]+),and\(\1\.eq\.([^,]+),id\.gt\.([^)]+)\)$/)
          if (!match) throw new Error(`Unsupported test filter ${expression}`)
          const [, key, before, equal, id] = match
          rows = rows.filter(row => String(row[key]) < before || String(row[key]) === equal && String(row.id) > id)
          return query
        },
        then: (resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) => {
          rows.sort((a, b) => {
            for (const order of orders) {
              const left = a[order.key], right = b[order.key]
              if (left == null || right == null) {
                if (left == null && right == null) continue
                return (left == null ? -1 : 1) * (order.nullsFirst ? 1 : -1)
              }
              const compared = String(left).localeCompare(String(right))
              if (compared) return compared * (order.ascending ? 1 : -1)
            }
            return 0
          })
          return Promise.resolve({ data: countOnly ? null : rows.slice(start, Math.min(end + 1, start + 1000)), count: rows.length, error: null }).then(resolve, reject)
        },
      }
      return query
    },
  }
}
function fixture(tables: Record<string, Row[]>) {
  state.client = { rpc: async () => ({ data: [], error: null }), ...databaseFixture(tables) }
}
function id(index: number) { return `a2000000-0000-4000-8000-${String(index).padStart(12, "0")}` }

beforeEach(() => {
  state.ctx.role = "owner"
  state.client = { rpc: async () => ({ data: [], error: null }), ...databaseFixture({
    activities: [
      { id: "mine", org_id: "A", owner: "me", done: false, record_type: "quote", record_id: "q" },
      { id: "theirs", org_id: "A", owner: "someone", done: false, record_type: "quote", record_id: "q" },
      { id: "foreign", org_id: "B", owner: "me", done: false, record_type: "quote", record_id: "q" },
      { id: "done", org_id: "A", owner: "me", done: true, type: "call", record_type: "quote", record_id: "q", completed_at: "2026-10-23T10:00:00Z" },
      { id: "other-record", org_id: "A", owner: "me", done: false, record_type: "deal", record_id: "q" },
    ],
    record_notes: [
      { id: "note", org_id: "A", record_type: "quote", record_id: "q", created_at: "2026-10-23T09:00:00Z", body: "Our note" },
      { id: "other-note", org_id: "B", record_type: "quote", record_id: "q", created_at: "2026-10-23T09:00:00Z", body: "Foreign note" },
    ],
    audit_log: [
      { id: "audit", org_id: "A", entity: "quote", entity_id: "q", created_at: "2026-10-23T08:00:00Z", summary: "Our change" },
      { id: "other-audit", org_id: "A", entity: "deal", entity_id: "q", created_at: "2026-10-23T08:00:00Z", summary: "Other change" },
    ],
  }) }
})
it("loads only the current user's incomplete active-workspace activities", async () => {
  expect((await myActivities()).map(activity => activity.id)).toEqual(["mine", "other-record"])
})
it("isolates history by org, record type and record id", async () => {
  const history = await recordHistory({ recordType: "quote", recordId: "q" })
  expect(history.planned.map(activity => activity.id)).toEqual(["mine", "theirs"])
  expect(history.timeline.map(entry => entry.text)).toEqual(["Call completed", "Our note", "Our change"])
})
it("preserves the staff-only audit restriction for workspace members", async () => {
  state.ctx.role = "member"
  const history = await recordHistory({ recordType: "quote", recordId: "q" })
  expect(history.canWrite).toBe(true)
  expect(history.canViewAudit).toBe(false)
  expect(history.timeline.some(entry => entry.kind === "audit")).toBe(false)
})
it("reports read failures instead of showing an empty history", async () => {
  state.client = { from: () => { throw new Error("database unavailable") } }
  await expect(myActivities()).rejects.toThrow("database unavailable")
})

it("keeps planned activities visible after one thousand earlier completed activities", async () => {
  const old = Array.from({ length: 1100 }, (_, index) => ({ id: id(index), org_id: "A", record_type: "quote", record_id: "q", owner: "me", done: true, type: "call", due_date: "2000-01-01", completed_at: "2026-01-01T00:00:00Z" }))
  fixture({ activities: [...old, { ...old[0], id: "open-new", done: false, due_date: "2026-12-01" }] })
  expect((await recordHistory({ recordType: "quote", recordId: "q" })).planned.map(activity => activity.id)).toEqual(["open-new"])
})
it("loads all personal open activities beyond the API's one thousand row cap", async () => {
  fixture({ activities: Array.from({ length: 1205 }, (_, index) => ({ id: id(index), org_id: "A", owner: "me", done: false, due_date: "2026-01-01" })) })
  expect(await myActivities()).toHaveLength(1205)
})
it("computes exact personal counts independent of returned data rows", async () => {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" })
  fixture({ activities: [
    ...Array.from({ length: 1205 }, (_, index) => ({ id: id(index), org_id: "A", owner: "me", done: false, due_date: "2000-01-01" })),
    { id: "today", org_id: "A", owner: "me", done: false, due_date: day },
    { id: "future", org_id: "A", owner: "me", done: false, due_date: "2999-01-01" },
    { id: "no-date", org_id: "A", owner: "me", done: false, due_date: null },
    { id: "done", org_id: "A", owner: "me", done: true, due_date: day },
    { id: "foreign", org_id: "B", owner: "me", done: false, due_date: day },
  ] })
  expect(await myActivityCounts()).toEqual({ overdue: 1205, today: 1, future: 1 })
})
it("pages all four timeline sources newest first without losing equal-time ties", async () => {
  const at = "2026-10-23T10:00:00.123456+00:00"
  const source = Array.from({ length: 1055 }, (_, index) => ({ id: id(index), org_id: "A", record_type: "quote", record_id: "q", created_at: at }))
  fixture({
    record_notes: source.map(row => ({ ...row, body: "Note", author: "author" })),
    record_attachments: source.slice(0, 4).map(row => ({ ...row, filename: "scope.pdf", uploaded_by: "uploader" })),
    activities: source.slice(0, 4).map(row => ({ ...row, done: true, type: "call", completed_at: at, completed_by: "completer" })),
    audit_log: source.slice(0, 4).map(row => ({ ...row, entity: "quote", entity_id: "q", summary: "Changed", action: "updated" })),
  })
  const ref = { recordType: "quote" as const, recordId: "q" }
  const first = await recordTimelinePage(ref)
  expect(first.timeline).toHaveLength(50)
  expect(first.nextCursor).not.toBeNull()
  const all = [...first.timeline]
  let cursor = first.nextCursor
  while (cursor) {
    const page = await recordTimelinePage(ref, cursor)
    expect(page.timeline.length).toBeLessThanOrEqual(50)
    all.push(...page.timeline)
    cursor = page.nextCursor
  }
  expect(all).toHaveLength(1067)
  expect(new Set(all.map(entry => entry.id)).size).toBe(all.length)
  expect(all.map(entry => entry.id)).toEqual([...all.map(entry => entry.id)].sort())
})
it("starts history with the newest notes beyond the API cap", async () => {
  fixture({ record_notes: Array.from({ length: 1205 }, (_, index) => ({ id: id(index), org_id: "A", record_type: "quote", record_id: "q", body: `Note ${index}`, created_at: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString() })) })
  const history = await recordHistory({ recordType: "quote", recordId: "q" })
  expect(history.timeline[0].text).toBe("Note 1204")
  expect(history.timeline).toHaveLength(50)
})
