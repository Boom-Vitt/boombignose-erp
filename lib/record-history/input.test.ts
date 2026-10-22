import { describe, expect, it } from "vitest"
import { AttachmentInput, CompleteInput, MAX_ATTACHMENT_SIZE, NoteInput, ScheduleInput, TimelinePageInput, UpdateActivityInput } from "./input"
const ref = { recordType: "quote", recordId: "10000000-0000-4000-8000-000000000001" }
describe("record history boundary validation", () => {
  it("validates trimmed notes, typed targets and real calendar dates", () => {
    expect(NoteInput.parse({ ...ref, body: "  hello  " }).body).toBe("hello")
    expect(NoteInput.safeParse({ ...ref, body: "  " }).success).toBe(false)
    expect(NoteInput.safeParse({ ...ref, recordType: "memberships", body: "hello" }).success).toBe(false)
    const activity = { ...ref, type: "call", owner: ref.recordId, summary: "Call buyer", dueDate: "2026-02-28" }
    expect(ScheduleInput.safeParse(activity).success).toBe(true)
    expect(ScheduleInput.safeParse({ ...activity, dueDate: "2026-02-30" }).success).toBe(false)
    expect(ScheduleInput.safeParse({ ...activity, owner: "" }).success).toBe(false)
  })
  it("accepts database ids that are not RFC 9562 shaped, like the seeded demo records", () => {
    const seeded = { recordType: "client", recordId: "c0000000-0000-0000-0000-000000000001" }
    expect(NoteInput.safeParse({ ...seeded, body: "hello" }).success).toBe(true)
    const activity = { ...seeded, type: "call", owner: "b0000000-0000-0000-0000-000000000001", summary: "Call buyer", dueDate: "2026-02-28" }
    expect(ScheduleInput.safeParse(activity).success).toBe(true)
  })
  it("preserves the exact timeline timestamp in a validated cursor", () => {
    const cursor = { at: "2026-10-23T10:00:00.123456+00:00", id: `note:${ref.recordId}` }
    expect(TimelinePageInput.parse({ ...ref, cursor }).cursor).toEqual(cursor)
  })
  it("enforces the 10 MB boundary, MIME allowlist, and safe filenames", () => {
    const file = { name: "scope.pdf", type: "application/pdf", size: MAX_ATTACHMENT_SIZE }
    expect(AttachmentInput.safeParse(file).success).toBe(true)
    expect(AttachmentInput.safeParse({ ...file, size: MAX_ATTACHMENT_SIZE + 1 }).success).toBe(false)
    expect(AttachmentInput.safeParse({ ...file, size: 0 }).success).toBe(false)
    expect(AttachmentInput.safeParse({ ...file, type: "image/svg+xml" }).success).toBe(false)
    expect(AttachmentInput.safeParse({ ...file, type: "text/html" }).success).toBe(false)
    expect(AttachmentInput.safeParse({ ...file, name: "../scope.pdf" }).success).toBe(false)
  })
  it("accepts a plain activity id or an object with a trimmed note and a next activity", () => {
    const id = ref.recordId
    const next = { type: "call", dueDate: "2026-11-02", owner: id, summary: "  Call back  " }
    expect(CompleteInput.parse(id)).toEqual({ id })
    expect(CompleteInput.parse({ id, feedback: "  done  ", next })).toEqual({ id, feedback: "done", next: { ...next, summary: "Call back" } })
    expect(CompleteInput.safeParse({ id, feedback: "x".repeat(2001) }).success).toBe(false)
    expect(CompleteInput.safeParse({ id, next: { ...next, dueDate: "2026-02-30" } }).success).toBe(false)
    expect(CompleteInput.safeParse("not-an-id").success).toBe(false)
  })
  it("validates an activity edit with the same field rules as scheduling", () => {
    const edit = { id: ref.recordId, type: "email", dueDate: "2026-11-02", owner: ref.recordId, summary: "  Send recap  " }
    expect(UpdateActivityInput.parse(edit).summary).toBe("Send recap")
    expect(UpdateActivityInput.safeParse({ ...edit, type: "sms" }).success).toBe(false)
    expect(UpdateActivityInput.safeParse({ ...edit, summary: " " }).success).toBe(false)
  })
})
