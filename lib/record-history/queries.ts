import { cache } from "react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { todayISO } from "@/lib/dates"
import { createClient } from "@/lib/supabase/server"
import type { Activity, RecordRef } from "./model"
import { mergeTimeline, pageTimeline, timelineCursorFilter, TIMELINE_PAGE_SIZE, type TimelineCursor } from "./timeline"

async function openActivities(orgId: string, owner?: string, ref?: RecordRef): Promise<Activity[]> {
  const supabase = await createClient()
  const activities: Activity[] = []
  let after: string | undefined
  for (;;) {
    let query = supabase.from("activities").select("*").eq("org_id", orgId).eq("done", false).order("id").limit(500)
    if (owner) query = query.eq("owner", owner)
    if (ref) query = query.eq("record_type", ref.recordType).eq("record_id", ref.recordId)
    if (after) query = query.gt("id", after)
    const { data, error } = await query
    if (error) throw new Error("Unable to load activities. Please try again.")
    activities.push(...(data ?? []))
    if (!data || data.length < 500) break
    after = data[data.length - 1].id
  }
  return activities.sort((a, b) => {
    if (a.due_date === b.due_date) return a.id.localeCompare(b.id)
    if (!a.due_date) return 1
    if (!b.due_date) return -1
    return a.due_date.localeCompare(b.due_date)
  })
}
export const myActivities = cache(async () => {
  const ctx = await requireOrgContext()
  return openActivities(ctx.orgId, ctx.userId)
})
export const myActivityCounts = cache(async () => {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()
  const query = () => supabase.from("activities").select("id", { head: true, count: "exact" })
    .eq("org_id", ctx.orgId).eq("owner", ctx.userId).eq("done", false)
  const [overdue, dueToday, future] = await Promise.all([
    query().lt("due_date", today), query().eq("due_date", today), query().gt("due_date", today),
  ])
  if ([overdue, dueToday, future].some(result => result.error || result.count == null)) throw new Error("Unable to load activity counts. Please try again.")
  return { overdue: overdue.count!, today: dueToday.count!, future: future.count! }
})
export async function recordTimelinePage(ref: RecordRef, cursor?: TimelineCursor) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  let notes = supabase.from("record_notes").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId)
    .order("created_at", { ascending: false }).order("id").limit(TIMELINE_PAGE_SIZE + 1)
  let attachments = supabase.from("record_attachments").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId)
    .order("created_at", { ascending: false }).order("id").limit(TIMELINE_PAGE_SIZE + 1)
  let activities = supabase.from("activities").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId).eq("done", true)
    .order("completed_at", { ascending: false }).order("id").limit(TIMELINE_PAGE_SIZE + 1)
  let audits = supabase.from("audit_log").select("*").eq("org_id", ctx.orgId).eq("entity", ref.recordType).eq("entity_id", ref.recordId)
    .order("created_at", { ascending: false }).order("id").limit(TIMELINE_PAGE_SIZE + 1)
  if (cursor) {
    notes = notes.or(timelineCursorFilter(cursor, "note", "created_at"))
    attachments = attachments.or(timelineCursorFilter(cursor, "attachment", "created_at"))
    activities = activities.or(timelineCursorFilter(cursor, "activity", "completed_at"))
    audits = audits.or(timelineCursorFilter(cursor, "audit", "created_at"))
  }
  const [noteRows, attachmentRows, activityRows, auditRows] = await Promise.all([
    notes, attachments, activities,
    can(ctx.role, "audit:view") ? audits : Promise.resolve({ data: [], error: null }),
  ])
  if ([noteRows, attachmentRows, activityRows, auditRows].some(result => result.error)) throw new Error("Unable to load record history. Please try again.")
  return pageTimeline(mergeTimeline({ notes: noteRows.data ?? [], attachments: attachmentRows.data ?? [], activities: activityRows.data ?? [], audits: auditRows.data ?? [] }))
}
export async function recordHistory(ref: RecordRef) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const [page, planned, assignees] = await Promise.all([
    recordTimelinePage(ref), openActivities(ctx.orgId, undefined, ref),
    supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId }),
  ])
  if (assignees.error) throw new Error("Unable to load activity assignees. Please try again.")
  const people = (assignees.data ?? []).map(person => ({ id: person.user_id, name: person.full_name || "Team member" }))
  return {
    ...page, planned, people, userId: ctx.userId,
    canWrite: can(ctx.role, "record:write"), canViewAudit: can(ctx.role, "audit:view"),
  }
}
