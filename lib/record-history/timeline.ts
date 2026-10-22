import { formatInTimeZone } from "date-fns-tz"
import { APP_TZ } from "@/lib/dates"
import type { Json, Tables } from "@/lib/types/database"
import { ACTIVITY_LABELS, type Activity } from "./model"

export type TimelineEntry = {
  id: string
  kind: "note" | "attachment" | "activity" | "audit"
  at: string
  actor: string | null
  text: string
  attachmentId?: string
}
function title(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase())
}
export function auditText(entry: { action: string; summary: string | null; meta: Json }): string {
  const meta = entry.meta && typeof entry.meta === "object" && !Array.isArray(entry.meta) ? entry.meta : {}
  const before = meta.from ?? meta.old_status ?? meta.oldStatus
  const after = meta.to ?? meta.new_status ?? meta.newStatus
  if (typeof before === "string" && typeof after === "string") return `Status: ${title(before)} → ${title(after)}`
  return entry.summary || title(entry.action)
}
export function timelineDay(at: string): string {
  return formatInTimeZone(at, APP_TZ, "d MMM yyyy")
}
export function mergeTimeline(input: {
  notes: Tables<"record_notes">[]
  attachments: Tables<"record_attachments">[]
  activities: Activity[]
  audits: Tables<"audit_log">[]
}): TimelineEntry[] {
  return [
    ...input.notes.map(note => ({ id: `note:${note.id}`, kind: "note" as const, at: note.created_at, actor: note.author, text: note.body })),
    ...input.attachments.map(file => ({ id: `attachment:${file.id}`, kind: "attachment" as const, at: file.created_at, actor: file.uploaded_by, text: file.filename, attachmentId: file.id })),
    ...input.activities.filter(activity => activity.done).map(activity => ({ id: `activity:${activity.id}`, kind: "activity" as const, at: activity.completed_at ?? activity.updated_at, actor: activity.owner, text: `${ACTIVITY_LABELS[activity.type]} completed${activity.body ? ` · ${activity.body}` : ""}` })),
    ...input.audits.map(audit => ({ id: `audit:${audit.id}`, kind: "audit" as const, at: audit.created_at, actor: audit.actor_id, text: auditText(audit) })),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id))
}
