import { cache } from "react"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import type { RecordRef } from "./model"
import { mergeTimeline } from "./timeline"

export const myActivities = cache(async () => {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("activities").select("*")
    .eq("org_id", ctx.orgId).eq("owner", ctx.userId).eq("done", false)
    .order("due_date", { ascending: true, nullsFirst: false }).order("created_at", { ascending: true })
  if (error) throw new Error("Unable to load your activities. Please try again.")
  return data ?? []
})
export async function recordHistory(ref: RecordRef) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const [notes, attachments, activities, audits, assignees] = await Promise.all([
    supabase.from("record_notes").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId),
    supabase.from("record_attachments").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId),
    supabase.from("activities").select("*").eq("org_id", ctx.orgId).eq("record_type", ref.recordType).eq("record_id", ref.recordId).order("due_date", { ascending: true, nullsFirst: false }),
    can(ctx.role, "audit:view") ? supabase.from("audit_log").select("*").eq("org_id", ctx.orgId).eq("entity", ref.recordType).eq("entity_id", ref.recordId) : Promise.resolve({ data: [], error: null }),
    supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId }),
  ])
  if ([notes, attachments, activities, audits, assignees].some(result => result.error)) throw new Error("Unable to load record history. Please try again.")
  const people = (assignees.data ?? []).map(person => ({ id: person.user_id, name: person.full_name || "Team member" }))
  return {
    timeline: mergeTimeline({ notes: notes.data ?? [], attachments: attachments.data ?? [], activities: activities.data ?? [], audits: audits.data ?? [] }),
    planned: (activities.data ?? []).filter(activity => !activity.done),
    people,
    userId: ctx.userId,
    canWrite: can(ctx.role, "record:write"),
    canViewAudit: can(ctx.role, "audit:view"),
  }
}
