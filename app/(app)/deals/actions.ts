"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { writeAudit } from "@/lib/audit"
import { logRecordNote } from "@/lib/record-history/actions"

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

const DealFields = z.object({
  clientId: z.guid("Pick a client"),
  title: z.string().min(1, "Title is required"),
  stage: z.enum(STAGES),
  valueBaht: z.coerce.number().min(0, "Value can't be negative"),
  /** Omitted: the database applies the stage default. */
  probability: z.coerce.number().int().min(0).max(100, "Probability is 0 to 100").optional(),
  lostReasonId: z.union([z.guid(), z.literal("")]).optional(),
  expectedCloseDate: z.string().optional(),
  nextFollowUpDate: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
})
const needsLostReason = (d: { stage: string; lostReasonId?: string }) => d.stage !== "lost" || !!d.lostReasonId
const LOST_REASON = { message: "Pick a lost reason", path: ["lostReasonId"] }
const DealInput = DealFields.refine(needsLostReason, LOST_REASON)
export type DealInput = z.infer<typeof DealInput>

/** Columns the deal form owns; the database derives won_at, lost_at and the closed probabilities. */
function dealColumns(d: DealInput) {
  return {
    client_id: d.clientId,
    title: d.title.trim(),
    stage: d.stage,
    value_satang: bahtToSatang(d.valueBaht),
    probability: d.probability,
    lost_reason_id: d.stage === "lost" ? d.lostReasonId : null,
    expected_close_date: nullableText(d.expectedCloseDate),
    next_follow_up_date: nullableText(d.nextFollowUpDate),
    source: nullableText(d.source),
    notes: nullableText(d.notes),
  }
}

/** Inserts a validated deal and writes its audit entry. */
async function insertDeal(
  ctx: Awaited<ReturnType<typeof requireOrgContext>>,
  d: DealInput
): Promise<{ id?: string; error?: string }> {
  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("deals")
    .insert({ org_id: ctx.orgId, ...dealColumns(d) })
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
  return { id: data.id }
}

export async function createDeal(input: DealInput): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DealInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const { id, error } = await insertDeal(ctx, parsed.data)
  if (!id) return { error }
  // redirect throws NEXT_REDIRECT — must stay outside any try/catch.
  redirect(`/deals/${id}`)
}

const QuickDealInput = DealFields.pick({
  clientId: true,
  title: true,
  stage: true,
  valueBaht: true,
}).refine((d) => d.stage !== "lost", { message: "Create the deal first, then mark it lost", path: ["stage"] })

/** Board quick create: same insert and audit as createDeal, but stays on the board. */
export async function quickCreateDeal(
  input: z.input<typeof QuickDealInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = QuickDealInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" }

  const { error } = await insertDeal(ctx, parsed.data)
  return error ? { error } : {}
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
  const { data: updated, error } = await supabase
    .from("deals")
    .update(dealColumns(d))
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .select("id")

  if (error) return { error: error.message }
  if (!updated.length) return { error: GONE }

  revalidatePath("/deals")
  revalidatePath(`/deals/${id}`)
  redirect(`/deals/${id}`)
}

const GONE = "This deal no longer exists. Refresh to see the latest pipeline."

const StageMove = z.object({
  id: z.guid(),
  stage: z.enum(STAGES),
  /** Board drops: the card it lands after; null or omitted puts it at the top of the column. */
  after: z.guid().nullish(),
  lostReasonId: z.guid().optional(),
  /** Optional closing note for a lost deal, kept in its record history. */
  note: z.string().trim().max(2000).optional(),
})

export async function updateDealStage(
  id: string,
  stage: string,
  place: { after?: string | null; lostReasonId?: string; note?: string } = {}
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = StageMove.safeParse({ id, stage, ...place })
  if (!parsed.success) return { error: "Invalid stage" }
  const m = parsed.data

  const supabase = await createSupabaseClient()
  // The title is only for the audit summary; move_deal reports the stage it replaced.
  const { data: before } = await supabase
    .from("deals")
    .select("title")
    .eq("id", id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()
  if (!before) return { error: GONE }

  const { data: from, error } = await supabase.rpc("move_deal", {
    p_org_id: ctx.orgId,
    p_deal_id: id,
    p_stage: m.stage,
    p_after_id: m.after ?? null,
    p_lost_reason_id: m.lostReasonId ?? null,
  })
  if (error) return { error: error.code === "P0002" ? GONE : error.message }

  if (from !== m.stage) {
    await writeAudit(ctx, {
      entity: "deal",
      entityId: id,
      action: "stage_changed",
      summary: `Moved deal "${before.title}" from ${from} → ${m.stage}`,
      meta: { from, to: m.stage, ...(m.lostReasonId ? { lostReasonId: m.lostReasonId } : {}) },
    })
  }
  if (m.stage === "lost" && m.note) {
    const logged = await logRecordNote({ recordType: "deal", recordId: id, body: `Lost: ${m.note}` })
    if (logged.error) return { error: "The deal is marked lost, but the note was not saved. Add it from the deal page." }
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
  dealId: z.guid(),
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
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (!deal) return { error: "Deal not found in the active workspace" }

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
