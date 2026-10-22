"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { minutesToHours, canEditTimeEntry } from "@/lib/metrics/timesheets"
import { moneyInput } from "@/lib/payments/input"
import { writeAudit } from "@/lib/audit"

/** Optional id select: "" (none) → null. */
const optionalId = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

/** Optional date (YYYY-MM-DD) from a date input: "" → null. */
const optionalDate = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))

/** Empty string from an optional <input> → undefined. */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/** Optional per-hour rate in baht: empty → null. */
const optionalRate = z
  .union([z.literal(""), z.coerce.number()])
  .optional()
  .transform((v) => (v === "" || v == null ? null : (v as number)))

const LogTime = z.object({
  project_id: z.string().min(1, "Project is required"),
  task_id: optionalId,
  work_date: optionalDate,
  hours: z.coerce.number().min(0, "Hours must be 0 or more").max(2147483647 / 60),
  billable: z.coerce.boolean().default(true),
  rateBaht: optionalRate,
  notes: optionalString,
})

export async function logTime(
  input: z.input<typeof LogTime>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const parsed = LogTime.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  if (d.rateBaht != null && d.rateBaht < 0) {
    return { error: "Rate must be 0 or more" }
  }

  const minutes = Math.round(d.hours * 60)
  let rate_satang: number | null
  try { rate_satang = d.rateBaht != null ? bahtToSatang(d.rateBaht) : null }
  catch { return { error: "Invalid hourly rate" } }

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("time_entries")
    .insert({
      org_id: ctx.orgId,
      project_id: d.project_id,
      task_id: d.task_id,
      user_id: ctx.userId,
      work_date: d.work_date ?? undefined,
      minutes,
      billable: d.billable,
      rate_satang,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "time_entry",
    entityId: data.id,
    action: "time_logged",
    summary: `Logged ${minutesToHours(minutes).toFixed(2)}h`,
    meta: { projectId: d.project_id, billable: d.billable },
  })

  revalidatePath("/timesheets")
  revalidatePath("/dashboard")
  revalidatePath(`/projects/${d.project_id}`)
  return {}
}

const DeleteTimeEntry = z.object({ id: z.string().min(1) })

export async function deleteTimeEntry(
  input: z.input<typeof DeleteTimeEntry>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const parsed = DeleteTimeEntry.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data: entry, error: readError } = await supabase.from("time_entries")
    .select("user_id,invoice_id,project_id,invoices(status)").eq("id", parsed.data.id).eq("org_id", ctx.orgId).maybeSingle()
  if (readError) return { error: readError.message }
  if (!entry || !canEditTimeEntry(ctx.userId, ctx.role, { ...entry, invoice_status: entry.invoices?.status ?? null })) {
    return { error: "Only authors or staff can change unbilled time. Cancel the invoice to unlock billed time." }
  }
  const { data: deleted, error } = await supabase
    .from("time_entries").delete().eq("id", parsed.data.id).eq("org_id", ctx.orgId).select("id").single()
  if (error || !deleted) return { error: error?.message ?? "Entry could not be deleted" }
  revalidatePath(`/projects/${entry.project_id}`)
  revalidatePath("/dashboard")

  await writeAudit(ctx, {
    entity: "time_entry",
    entityId: parsed.data.id,
    action: "deleted",
    summary: "Deleted a time entry",
  })

  revalidatePath("/timesheets")
  return {}
}

const UpdateTimeEntry = z.object({
  id: z.string().min(1),
  minutes: z.coerce.number().int().min(0).max(2147483647),
  billable: z.boolean(),
  rateBaht: z.string().refine(v => { try { if (v !== "") moneyInput(v); return true } catch { return false } }),
  notes: z.string().trim().max(5000),
})

export async function updateTimeEntry(input: z.input<typeof UpdateTimeEntry>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const parsed = UpdateTimeEntry.safeParse(input)
  if (!parsed.success) return { error: "Invalid time entry" }
  const supabase = await createSupabaseClient()
  const { data: entry, error: readError } = await supabase.from("time_entries")
    .select("user_id,invoice_id,project_id,invoices(status)").eq("id", parsed.data.id).eq("org_id", ctx.orgId).maybeSingle()
  if (readError) return { error: readError.message }
  if (!entry || !canEditTimeEntry(ctx.userId, ctx.role, { ...entry, invoice_status: entry.invoices?.status ?? null })) {
    return { error: "Only authors or staff can change unbilled time. Cancel the invoice to unlock billed time." }
  }
  const d = parsed.data
  const { data, error } = await supabase.from("time_entries").update({
    minutes: d.minutes, billable: d.billable, rate_satang: d.rateBaht === "" ? null : moneyInput(d.rateBaht), notes: d.notes || null,
  }).eq("org_id", ctx.orgId).eq("id", d.id).select("id").single()
  if (error || !data) return { error: error?.message ?? "Entry could not be updated" }
  await writeAudit(ctx, { entity: "time_entry", entityId: d.id, action: "updated", summary: "Updated unbilled time" })
  revalidatePath("/timesheets")
  revalidatePath("/dashboard")
  revalidatePath(`/projects/${entry.project_id}`)
  return {}
}

const BillTime = z.object({ project_id: z.guid(), key: z.uuid() })
export async function billTime(input: z.input<typeof BillTime>): Promise<{ error?: string; invoiceId?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "invoice:delete") } catch { return { error: "Only staff may bill time" } }
  const parsed = BillTime.safeParse(input)
  if (!parsed.success) return { error: "Invalid billing request" }
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase.rpc("bill_project_time", { p_org_id: ctx.orgId, p_project_id: parsed.data.project_id, p_key: parsed.data.key })
  if (error) return { error: error.message }
  revalidatePath("/timesheets")
  revalidatePath("/finance")
  revalidatePath(`/projects/${parsed.data.project_id}`)
  return { invoiceId: data }
}

const MemberCostRate = z.object({ user_id: z.guid(), rateBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }) })
export async function setMemberCostRate(input: z.input<typeof MemberCostRate>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") } catch { return { error: "Only staff may set cost rates" } }
  const parsed = MemberCostRate.safeParse(input)
  if (!parsed.success) return { error: "Invalid cost rate" }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("set_member_cost_rate", { p_org_id: ctx.orgId, p_user_id: parsed.data.user_id, p_rate_satang: moneyInput(parsed.data.rateBaht) })
  if (error) return { error: error.message }
  revalidatePath("/timesheets")
  revalidatePath("/projects", "layout")
  return {}
}
