"use server"

import { randomUUID } from "node:crypto"
import { z } from "zod"
import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"
import { AttachmentInput, NoteInput, RecordInput, ScheduleInput } from "./input"
import { RECORD_TABLES, recordHref, type RecordRef } from "./model"

async function writableRecord(ref: RecordRef) {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  const { data, error } = await supabase.from(RECORD_TABLES[ref.recordType]).select("id").eq("org_id", ctx.orgId).eq("id", ref.recordId).maybeSingle()
  if (error || !data) throw new Error("Record not found in the active workspace.")
  return { ctx, supabase }
}
function refresh(ref: RecordRef) {
  revalidatePath(recordHref(ref.recordType, ref.recordId))
  revalidatePath("/activities")
  revalidatePath("/", "layout")
}
export async function logRecordNote(input: unknown): Promise<{ error?: string }> {
  const parsed = NoteInput.safeParse(input)
  if (!parsed.success) return { error: "Enter a note of 1 to 20,000 characters." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  const { error } = await supabase.from("record_notes").insert({ org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, author: ctx.userId, body: ref.body })
  if (error) return { error: "Unable to save the note. Please try again." }
  refresh(ref)
  return {}
}
export async function scheduleRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = ScheduleInput.safeParse(input)
  if (!parsed.success) return { error: "Choose a type, valid due date, assignee, and summary." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  const { data: assignees, error: memberError } = await supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId })
  if (memberError || !assignees?.some(member => member.user_id === ref.owner)) return { error: "Choose an assignee from the active workspace." }
  const { error } = await supabase.from("activities").insert({ org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, owner: ref.owner, type: ref.type, body: ref.summary, due_date: ref.dueDate })
  if (error) return { error: "Unable to schedule the activity. Please try again." }
  await writeAudit(ctx, { entity: ref.recordType, entityId: ref.recordId, action: "activity_scheduled", summary: `Scheduled ${ref.type.replaceAll("_", " ")}`, meta: { dueDate: ref.dueDate } })
  refresh(ref)
  return {}
}
export async function completeRecordActivity(input: unknown): Promise<{ error?: string }> {
  const parsed = z.uuid().safeParse(input)
  if (!parsed.success) return { error: "Invalid activity." }
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const supabase = await createClient()
  const { data: activity, error: readError } = await supabase.from("activities").select("record_type,record_id,done").eq("org_id", ctx.orgId).eq("id", parsed.data).maybeSingle()
  if (readError || !activity) return { error: "Activity not found in the active workspace." }
  const { error } = await supabase.from("activities").update({ done: true }).eq("org_id", ctx.orgId).eq("id", parsed.data).eq("done", false)
  if (error) return { error: "Unable to complete the activity. Please try again." }
  if (activity.record_type && activity.record_id) refresh({ recordType: activity.record_type, recordId: activity.record_id })
  else { revalidatePath("/activities"); revalidatePath("/", "layout") }
  return {}
}
export async function attachRecordFile(form: FormData): Promise<{ error?: string }> {
  const parsed = RecordInput.safeParse({ recordType: form.get("recordType"), recordId: form.get("recordId") })
  const file = form.get("file")
  if (!parsed.success || !(file instanceof File)) return { error: "Choose a file and a valid record." }
  const valid = AttachmentInput.safeParse({ name: file.name, size: file.size, type: file.type })
  if (!valid.success) return { error: "Use a PDF, JPEG, PNG, WebP, text, or CSV file up to 10 MB with a valid filename." }
  const ref = parsed.data
  const { ctx, supabase } = await writableRecord(ref)
  const id = randomUUID()
  const path = `${ctx.orgId}/${ref.recordType}/${ref.recordId}/${id}`
  const bucket = supabase.storage.from("record-attachments")
  const { error: uploadError } = await bucket.upload(path, file, { contentType: file.type, upsert: false })
  if (uploadError) return { error: "Unable to upload the file. Please try again." }
  const { error } = await supabase.from("record_attachments").insert({ id, org_id: ctx.orgId, record_type: ref.recordType, record_id: ref.recordId, path, filename: valid.data.name, size: file.size, content_type: file.type, uploaded_by: ctx.userId })
  if (error) {
    const cleanup = await bucket.remove([path])
    if (cleanup.error) console.error("Record attachment cleanup failed", cleanup.error.message)
    return { error: "Unable to save the attachment. Please try again." }
  }
  await writeAudit(ctx, { entity: ref.recordType, entityId: ref.recordId, action: "file_attached", summary: `Attached ${valid.data.name}` })
  refresh(ref)
  return {}
}
export async function recordAttachmentUrl(input: unknown): Promise<{ url?: string; error?: string }> {
  const parsed = z.uuid().safeParse(input)
  if (!parsed.success) return { error: "Invalid attachment." }
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("record_attachments").select("path,filename").eq("org_id", ctx.orgId).eq("id", parsed.data).maybeSingle()
  if (error || !data) return { error: "Attachment not found in the active workspace." }
  const result = await supabase.storage.from("record-attachments").createSignedUrl(data.path, 60, { download: data.filename })
  if (result.error) return { error: "Unable to download the attachment." }
  return { url: result.data.signedUrl }
}
