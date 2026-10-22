import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ canWrite: true }))
vi.mock("@/lib/record-history/actions", () => ({
  attachRecordFile: vi.fn(), cancelRecordActivity: vi.fn(), completeRecordActivity: vi.fn(), loadRecordHistoryPage: vi.fn(),
  logRecordNote: vi.fn(), recordAttachmentUrl: vi.fn(), scheduleRecordActivity: vi.fn(), updateRecordActivity: vi.fn(),
}))
vi.mock("@/lib/record-history/queries", () => ({
  recordHistory: async () => ({
    timeline: [], nextCursor: null, userId: "u1", canWrite: state.canWrite, canViewAudit: false,
    people: [{ id: "u1", name: "Ploy" }],
    planned: [
      { id: "a1", type: "call", body: "Discuss scope", due_date: "2026-10-30", owner: "u1" },
      { id: "a2", type: "email", body: "Send recap", due_date: null, owner: null },
    ],
  }),
}))
import { RecordHistory } from "@/components/record/record-history"

const count = (html: string, text: string) => html.split(`>${text}<`).length - 1
async function render() {
  return renderToStaticMarkup(await RecordHistory({ recordType: "quote", recordId: "10000000-0000-4000-8000-000000000003" }))
}
beforeEach(() => { state.canWrite = true })
describe("planned activities on a record page", () => {
  it("offers Mark done, Edit and Cancel for every planned activity to a writer", async () => {
    const html = await render()
    expect(html).toContain("Planned activities (2)")
    for (const control of ["Mark done", "Edit", "Cancel"]) expect(count(html, control)).toBe(2)
  })
  it("shows planned activities without any controls to a read-only viewer", async () => {
    state.canWrite = false
    const html = await render()
    expect(html).toContain("Discuss scope")
    for (const control of ["Mark done", "Edit", "Cancel"]) expect(count(html, control)).toBe(0)
  })
})
