"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang, formatTHBWhole } from "@/lib/money"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { generateSubscriptionOccurrence } from "@/lib/billing/generate"

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const
const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const

/** Optional id select: "" (none) → null. */
const optionalId = z
  .union([z.uuid(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : null))

/** Empty string from an optional <input> → undefined. */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

/** Optional date (YYYY-MM-DD): "" → undefined. */
const optionalDate = z
  .union([z.iso.date(), z.literal("")])
  .optional()
  .transform((v) => (v ? v : undefined))

const amountBaht = z.coerce.number().min(0).refine(value => {
  try { bahtToSatang(value); return true } catch { return false }
}, "Amount exceeds safe satang bounds")

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateSubscription = z.object({
  client_id: z.uuid("Client is required"),
  project_id: optionalId,
  name: z.string().trim().min(1, "Name is required"),
  amountBaht,
  interval: z.enum(RECURRING_INTERVALS),
  start_date: optionalDate,
  notes: optionalString,
})

export async function createSubscription(
  input: z.input<typeof CreateSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "subscription:manage")
  } catch {
    return { error: "Only owners and admins can manage subscriptions." }
  }
  const parsed = CreateSubscription.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const start = d.start_date ?? todayISO()

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("subscriptions")
    .insert({
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
      name: d.name,
      amount_satang: bahtToSatang(d.amountBaht),
      interval: d.interval,
      status: "active",
      start_date: start,
      next_run_date: start,
      auto_generate: true,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: data.id,
    action: "created",
    summary: `Created subscription ${d.name} (${formatTHBWhole(bahtToSatang(d.amountBaht))}/${d.interval})`,
  })

  revalidatePath("/finance/subscriptions")
  redirect(`/finance/subscriptions/${data.id}`)
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const UpdateSubscription = z.object({
  id: z.uuid(),
  client_id: z.uuid("Client is required"),
  project_id: optionalId,
  name: z.string().trim().min(1, "Name is required"),
  amountBaht,
  interval: z.enum(RECURRING_INTERVALS),
  start_date: optionalDate,
  notes: optionalString,
})

export async function updateSubscription(
  input: z.input<typeof UpdateSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "subscription:manage")
  } catch {
    return { error: "Only owners and admins can manage subscriptions." }
  }
  const parsed = UpdateSubscription.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  // The billing schedule is anchored on the start date and users cannot move next_run_date,
  // so a new start would leave every scheduled run rejected by generate_subscription_occurrence.
  // shortcut: refuses the edit, upgrade to re-anchoring next_run_date in guard_subscription_schedule (migration) if users need it.
  if (d.start_date) {
    const { data: current } = await supabase
      .from("subscriptions")
      .select("start_date")
      .eq("id", d.id)
      .eq("org_id", ctx.orgId)
      .maybeSingle()
    if (current && current.start_date !== d.start_date) {
      return { error: "The start date can't be changed. Create a new subscription for a different start date." }
    }
  }
  const { error } = await supabase
    .from("subscriptions")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      name: d.name,
      amount_satang: bahtToSatang(d.amountBaht),
      interval: d.interval,
      start_date: d.start_date ?? undefined,
      notes: d.notes ?? null,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: d.id,
    action: "updated",
    summary: `Updated subscription ${d.name}`,
  })

  revalidatePath("/finance/subscriptions")
  revalidatePath(`/finance/subscriptions/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const SetStatus = z.object({
  id: z.uuid(),
  status: z.enum(SUBSCRIPTION_STATUSES),
})

export async function setSubscriptionStatus(
  input: z.input<typeof SetStatus>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "subscription:manage")
  } catch {
    return { error: "Only owners and admins can manage subscriptions." }
  }
  const parsed = SetStatus.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("subscriptions")
    .update({ status: d.status })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: d.id,
    action: "status_changed",
    summary: `Set subscription status to ${d.status}`,
    meta: { status: d.status },
  })

  revalidatePath("/finance/subscriptions")
  revalidatePath(`/finance/subscriptions/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const DeleteSubscription = z.object({ id: z.uuid() })

export async function deleteSubscription(
  input: z.input<typeof DeleteSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "subscription:manage")
  } catch {
    return { error: "Only owners and admins can delete subscriptions." }
  }
  const parsed = DeleteSubscription.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("subscriptions")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: parsed.data.id,
    action: "deleted",
    summary: "Deleted subscription",
  })

  revalidatePath("/finance/subscriptions")
  redirect("/finance/subscriptions")
}

// ---------------------------------------------------------------------------
// Manual invoice generation
// ---------------------------------------------------------------------------

const GenerateNow = z.object({ id: z.uuid(), occurrence: z.iso.date() })

export async function generateInvoiceNow(
  input: { id: string; occurrence?: string }
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "subscription:manage")
  } catch {
    return { error: "Only owners and admins can generate invoices." }
  }
  const parsed = GenerateNow.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  try {
    await generateSubscriptionOccurrence(supabase, ctx.orgId, parsed.data.id, parsed.data.occurrence)
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Invoice generation failed" }
  }
  revalidatePath("/finance")
  revalidatePath("/finance/subscriptions")
  revalidatePath(`/finance/subscriptions/${parsed.data.id}`)
  return {}
}
