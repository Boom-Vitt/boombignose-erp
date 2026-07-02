"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { writeAudit } from "@/lib/audit"

const STAGES = [
  "lead",
  "contacted",
  "discovery",
  "proposal",
  "negotiation",
  "won",
  "lost",
] as const

const ACTIVITY_TYPES = ["note", "call", "email", "meeting", "follow_up"] as const

/** Empty string from a form -> null for nullable columns. */
function nullableText(v: string | null | undefined): string | null {
  const t = (v ?? "").trim()
  return t === "" ? null : t
}

const DealInput = z.object({
  clientId: z.string().uuid("Pick a client"),
  title: z.string().min(1, "Title is required"),
  stage: z.enum(STAGES),
  valueBaht: z.coerce.number().min(0, "Value can't be negative"),
  expectedCloseDate: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
})
export type DealInput = z.infer<typeof DealInput>

export async function createDeal(input: DealInput): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DealInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("deals")
    .insert({
      org_id: ctx.orgId,
      client_id: d.clientId,
      title: d.title.trim(),
      stage: d.stage,
      value_satang: bahtToSatang(d.valueBaht),
      expected_close_date: nullableText(d.expectedCloseDate),
      next_follow_up_date: nullableText(d.nextFollowUpDate),
      source: nullableText(d.source),
      notes: nullableText(d.notes),
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "deal",
    entityId: data.id,
    action: "created",
    summary: `Created deal "${d.title.trim()}"`,
  })

  revalidatePath("/deals")
  // redirect throws NEXT_REDIRECT — must stay outside any try/catch.
  redirect(`/deals/${data.id}`)
}

export async function updateDeal(
  id: string,
  input: DealInput
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DealInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("deals")
    .update({
      client_id: d.clientId,
      title: d.title.trim(),
      stage: d.stage,
      value_satang: bahtToSatang(d.valueBaht),
      expected_close_date: nullableText(d.expectedCloseDate),
      next_follow_up_date: nullableText(d.nextFollowUpDate),
      source: nullableText(d.source),
      notes: nullableText(d.notes),
    })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/deals")
  revalidatePath(`/deals/${id}`)
  redirect(`/deals/${id}`)
}

const StageInput = z.enum(STAGES)

export async function updateDealStage(
  id: string,
  stage: string
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = StageInput.safeParse(stage)
  if (!parsed.success) return { error: "Invalid stage" }

  const supabase = await createSupabaseClient()
  // Capture the prior stage + title for the audit summary before we overwrite.
  const { data: before } = await supabase
    .from("deals")
    .select("title, stage")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  const { error } = await supabase
    .from("deals")
    .update({ stage: parsed.data })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  if (before && before.stage !== parsed.data) {
    await writeAudit(ctx, {
      entity: "deal",
      entityId: id,
      action: "stage_changed",
      summary: `Moved deal "${before.title}" from ${before.stage} → ${parsed.data}`,
      meta: { from: before.stage, to: parsed.data },
    })
  }

  revalidatePath("/deals")
  revalidatePath(`/deals/${id}`)
  return {}
}

export async function deleteDeal(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "deal:delete")
  } catch {
    return { error: "Only owners and admins can delete deals." }
  }

  const supabase = await createSupabaseClient()
  // Read the title before deletion so the audit summary can name the deal.
  const { data: before } = await supabase
    .from("deals")
    .select("title")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  // Detach activities so the deal can be removed without FK errors.
  await supabase
    .from("activities")
    .update({ deal_id: null })
    .eq("deal_id", id)
    .eq("org_id", ctx.orgId)
  const { error } = await supabase
    .from("deals")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId)
  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "deal",
    entityId: id,
    action: "deleted",
    summary: before ? `Deleted deal "${before.title}"` : "Deleted a deal",
  })

  revalidatePath("/deals")
  redirect("/deals")
}

const ActivityInput = z.object({
  dealId: z.string().uuid(),
  type: z.enum(ACTIVITY_TYPES),
  body: z.string().optional(),
  dueDate: z.string().optional(),
})
export type ActivityInput = z.infer<typeof ActivityInput>

export async function addActivity(input: ActivityInput): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ActivityInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid activity" }
  const a = parsed.data

  const supabase = await createSupabaseClient()
  // Carry the deal's client onto the activity so it links to the client too.
  const { data: deal } = await supabase
    .from("deals")
    .select("client_id")
    .eq("id", a.dealId)
    .maybeSingle()

  const { error } = await supabase.from("activities").insert({
    org_id: ctx.orgId,
    deal_id: a.dealId,
    client_id: deal?.client_id ?? null,
    type: a.type,
    body: nullableText(a.body),
    due_date: nullableText(a.dueDate),
  })

  if (error) return { error: error.message }

  revalidatePath(`/deals/${a.dealId}`)
  return {}
}

export async function toggleActivityDone(
  id: string,
  done: boolean,
  dealId: string
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("activities")
    .update({ done })
    .eq("id", id)
    .eq("org_id", ctx.orgId)
  if (error) return { error: error.message }

  revalidatePath(`/deals/${dealId}`)
  return {}
}
