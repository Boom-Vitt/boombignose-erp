import { beforeEach, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
const state = vi.hoisted(() => ({ client: {} as unknown, ctx: { orgId: "A", userId: "me", role: "owner" } }))
vi.mock("react", () => ({ cache: (fn: unknown) => fn }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => state.ctx }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
import { myActivities, recordHistory } from "./queries"

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
