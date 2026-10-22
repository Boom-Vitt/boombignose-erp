import { beforeEach, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
const state = vi.hoisted(() => ({
  client: {} as unknown,
  ctx: { orgId: "10000000-0000-4000-8000-000000000001", userId: "10000000-0000-4000-8000-000000000002", role: "member" },
  capability: vi.fn(), upload: vi.fn(), remove: vi.fn(), signed: vi.fn(),
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => state.ctx, requireCapability: state.capability }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
vi.mock("@/lib/audit", () => ({ writeAudit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
import { attachRecordFile, completeRecordActivity, logRecordNote, recordAttachmentUrl, scheduleRecordActivity, loadRecordHistoryPage } from "./actions"

const recordId = "10000000-0000-4000-8000-000000000003"
const activityId = "10000000-0000-4000-8000-000000000004"
const ref = { recordType: "quote", recordId }
let tables: Record<string, Record<string, unknown>[]>
let updates: { table: string; values: unknown }[]
let filters: { table: string; key: string; value: unknown }[]
function client(failedTable?: string) {
  const fixture = databaseFixture(tables)
  return {
    from(table: string) {
      const query = fixture.from(table)
      const eq = query.eq
      query.eq = (key, value) => { filters.push({ table, key, value }); return eq(key, value) }
      if (table === failedTable) query.then = (resolve, reject) => Promise.resolve({ data: null, error: { message: "Synthetic failure" } }).then(resolve, reject)
      return Object.assign(query, { update: (values: unknown) => { updates.push({ table, values }); return query } })
    },
    rpc: async (_name: string, args: { p_org_id: string }) => ({ data: (tables.memberships ?? []).filter(member => member.org_id === args.p_org_id), error: null }),
    storage: { from: () => ({ upload: state.upload, remove: state.remove, createSignedUrl: state.signed }) },
  }
}
beforeEach(() => {
  vi.clearAllMocks()
  state.capability.mockReset()
  state.upload.mockResolvedValue({ error: null })
  state.remove.mockResolvedValue({ error: null })
  state.signed.mockResolvedValue({ data: { signedUrl: "https://storage.example.invalid/signed" }, error: null })
  updates = []; filters = []
  tables = {
    quotes: [{ id: recordId, org_id: state.ctx.orgId }],
    memberships: [{ org_id: state.ctx.orgId, user_id: state.ctx.userId }, { org_id: state.ctx.orgId, user_id: "10000000-0000-4000-8000-000000000005" }],
    activities: [{ id: activityId, org_id: state.ctx.orgId, done: false, record_type: "quote", record_id: recordId }],
  }
  state.client = client()
})
it("saves trimmed notes under the active org and authenticated author", async () => {
  expect(await logRecordNote({ ...ref, body: "  Team context  ", author: "forged", org_id: "foreign" })).toEqual({})
  expect(tables.record_notes).toEqual([{ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, author: state.ctx.userId, body: "Team context" }])
  expect(state.capability).toHaveBeenCalledWith(state.ctx, "record:write")
})
it("blames the record, not the note, when the target id is invalid", async () => {
  expect(await logRecordNote({ ...ref, recordId: "not-an-id", body: "Context" })).toEqual({ error: "This record is not available. Reload the page and try again." })
  expect(await logRecordNote({ ...ref, body: "  " })).toEqual({ error: "Enter a note of 1 to 20,000 characters." })
  expect(tables.record_notes).toBeUndefined()
})
it("rejects missing active-workspace targets before mutation", async () => {
  tables.quotes[0].org_id = "foreign"
  await expect(logRecordNote({ ...ref, body: "Context" })).rejects.toThrow("Record not found")
  expect(tables.record_notes).toBeUndefined()
})
it("honors capability denial before writing", async () => {
  state.capability.mockImplementation(() => { throw new Error("Forbidden") })
  await expect(logRecordNote({ ...ref, body: "Context" })).rejects.toThrow("Forbidden")
  expect(tables.record_notes).toBeUndefined()
})
it("schedules for a current workspace member and rejects foreign assignees", async () => {
  const input = { ...ref, type: "meeting", dueDate: "2026-10-23", owner: "10000000-0000-4000-8000-000000000005", summary: "Scope review" }
  expect(await scheduleRecordActivity({ ...input, owner: "10000000-0000-4000-8000-000000000099" })).toHaveProperty("error")
  expect(tables.activities).toHaveLength(1)
  expect(await scheduleRecordActivity(input)).toEqual({})
  expect(tables.activities[1]).toMatchObject({ org_id: state.ctx.orgId, record_type: "quote", record_id: recordId, owner: input.owner, due_date: input.dueDate, body: input.summary })
})
it("marks only a stored activity in the active org done and scopes the update", async () => {
  expect(await completeRecordActivity(activityId)).toEqual({})
  expect(updates).toEqual([{ table: "activities", values: { done: true, completed_by: state.ctx.userId, completed_at: expect.any(String) } }])
  expect(filters).toEqual(expect.arrayContaining([
    { table: "activities", key: "org_id", value: state.ctx.orgId }, { table: "activities", key: "id", value: activityId }, { table: "activities", key: "done", value: false },
  ]))
  tables.activities[0].org_id = "foreign"
  updates = []
  expect(await completeRecordActivity(activityId)).toHaveProperty("error")
  expect(updates).toHaveLength(0)
})
function uploadForm(file: File) {
  const form = new FormData()
  form.set("recordType", "quote"); form.set("recordId", recordId); form.set("file", file)
  return form
}
it("rejects an unsupported attachment at the action boundary before storage", async () => {
  expect(await attachRecordFile(uploadForm(new File(["html"], "page.html", { type: "text/html" })))).toHaveProperty("error")
  expect(state.upload).not.toHaveBeenCalled()
  expect(state.capability).not.toHaveBeenCalled()
})
it("generates a bound private path and records upload metadata", async () => {
  const file = new File(["scope"], "scope.txt", { type: "text/plain" })
  expect(await attachRecordFile(uploadForm(file))).toEqual({})
  const attachment = tables.record_attachments[0]
  expect(attachment.path).toBe(`${state.ctx.orgId}/quote/${recordId}/${attachment.id}`)
  expect(attachment).toMatchObject({ org_id: state.ctx.orgId, uploaded_by: state.ctx.userId, filename: "scope.txt", size: 5, content_type: "text/plain" })
  expect(state.upload).toHaveBeenCalledWith(attachment.path, expect.any(File), { contentType: "text/plain", upsert: false })
})
it("cleans up uploaded objects when metadata cannot be saved", async () => {
  state.client = client("record_attachments")
  expect(await attachRecordFile(uploadForm(new File(["scope"], "scope.txt", { type: "text/plain" })))).toHaveProperty("error")
  expect(state.remove).toHaveBeenCalledWith([state.upload.mock.calls[0][0]])
})
it("signs only active-org downloads for one minute with attachment disposition", async () => {
  tables.record_attachments = [{ id: activityId, org_id: state.ctx.orgId, path: "private/path", filename: "scope.txt" }]
  expect(await recordAttachmentUrl(activityId)).toEqual({ url: "https://storage.example.invalid/signed" })
  expect(state.signed).toHaveBeenCalledWith("private/path", 60, { download: "scope.txt" })
  state.signed.mockClear()
  tables.record_attachments[0].org_id = "foreign"
  expect(await recordAttachmentUrl(activityId)).toHaveProperty("error")
  expect(state.signed).not.toHaveBeenCalled()
})

it("rejects forged or malformed timeline cursors before querying history", async () => {
  expect(await loadRecordHistoryPage({ ...ref, cursor: { at: "2026-10-23T10:00:00Z", id: "note:forged),or(org_id.neq.any)" } })).toHaveProperty("error")
  expect(await loadRecordHistoryPage({ ...ref, cursor: { at: "yesterday", id: `note:${activityId}` } })).toHaveProperty("error")
  expect(filters).toHaveLength(0)
})
it("completes activities and signs attachments whose ids lack RFC 9562 version bits", async () => {
  const [seedActivity, seedAttachment] = ["40000000-0000-0000-0000-000000000001", "40000000-0000-0000-0000-000000000002"]
  tables.activities[0].id = seedActivity
  tables.record_attachments = [{ id: seedAttachment, org_id: state.ctx.orgId, path: "private/path", filename: "scope.txt" }]
  expect(await completeRecordActivity(seedActivity)).toEqual({})
  expect(filters).toEqual(expect.arrayContaining([{ table: "activities", key: "id", value: seedActivity }]))
  expect(await recordAttachmentUrl(seedAttachment)).toEqual({ url: "https://storage.example.invalid/signed" })
})
