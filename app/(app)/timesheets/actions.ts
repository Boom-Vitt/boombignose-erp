"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { minutesToHours } from "@/lib/metrics/timesheets"
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
  .union([z.coerce.number(), z.literal("")])
  .optional()
  .transform((v) => (v === "" || v == null ? null : (v as number)))

const LogTime = z.object({
  project_id: z.string().min(1, "Project is required"),
  task_id: optionalId,
  work_date: optionalDate,
  hours: z.coerce.number().min(0, "Hours must be 0 or more"),
  billable: z.coerce.boolean().default(true),
  rateBaht: optionalRate,
  notes: optionalString,
})

export async function logTime(
  input: z.input<typeof LogTime>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = LogTime.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  if (d.rateBaht != null && d.rateBaht < 0) {
    return { error: "Rate must be 0 or more" }
  }

  const minutes = Math.round(d.hours * 60)
  const rate_satang = d.rateBaht != null ? bahtToSatang(d.rateBaht) : null

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
  revalidatePath(`/projects/${d.project_id}`)
  return {}
}

const DeleteTimeEntry = z.object({ id: z.string().min(1) })

export async function deleteTimeEntry(
  input: z.input<typeof DeleteTimeEntry>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DeleteTimeEntry.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("time_entries")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "time_entry",
    entityId: parsed.data.id,
    action: "deleted",
    summary: "Deleted a time entry",
  })

  revalidatePath("/timesheets")
  return {}
}
