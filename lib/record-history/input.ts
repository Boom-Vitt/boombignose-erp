import { z } from "zod"
import { RECORD_TYPES } from "./model"

export const RecordInput = z.object({ recordType: z.enum(RECORD_TYPES), recordId: z.uuid() })
export const NoteInput = RecordInput.extend({ body: z.string().trim().min(1).max(20000) })
export const ScheduleInput = RecordInput.extend({
  type: z.enum(["call", "email", "meeting", "follow_up", "note"]),
  dueDate: z.iso.date(),
  owner: z.uuid(),
  summary: z.string().trim().min(1).max(2000),
})
export const MAX_ATTACHMENT_SIZE = 10 * 1024 * 1024
export const ATTACHMENT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "text/plain", "text/csv"] as const
export const AttachmentInput = z.object({
  name: z.string().trim().min(1).max(255).refine(name => !/[\x00-\x1f\x7f/\\]/.test(name), "Invalid filename"),
  size: z.number().int().positive().max(MAX_ATTACHMENT_SIZE),
  type: z.enum(ATTACHMENT_TYPES),
})

export const TimelinePageInput = RecordInput.extend({
  cursor: z.object({
    at: z.iso.datetime({ offset: true }),
    id: z.string().regex(/^(note|attachment|activity|audit):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/),
  }),
})
