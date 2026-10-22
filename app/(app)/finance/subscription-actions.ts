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
import { WHT_RATES } from "@/lib/tax/totals"

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const
const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const

/** Optional id select: "" (none) → null. */
const optionalId = z
  .union([z.guid(), z.literal(""), z.null()])
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

const taxFields = {
  product_id: z.union([z.guid(), z.literal(""), z.null()]).optional().transform(value => value === undefined ? undefined : value || null),
  unit: z.string().trim().min(1).max(40).optional(),
  tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  wht_rate_bps: z.number().int().refine(value => (WHT_RATES as readonly number[]).includes(value)).optional(),
  prices_include_vat: z.boolean().optional(),
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateSubscription = z.object({
  ...taxFields,
  client_id: z.guid("Client is required"),
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
  let taxRate = d.tax_rate_bps
  let whtRate = d.wht_rate_bps
  let unit = d.unit
  let pricesIncludeVat = d.prices_include_vat
  if (d.product_id) {
    const { data: product, error } = await supabase.from("products")
      .select("tax_rate_bps, wht_rate_bps, unit").eq("org_id", ctx.orgId).eq("id", d.product_id).eq("active", true).maybeSingle()
    if (error) return { error: error.message }
    if (!product) return { error: "Product unavailable. Choose an active product or a free-text line." }
    taxRate ??= product.tax_rate_bps
    whtRate ??= product.wht_rate_bps ?? undefined
    unit ??= product.unit
  }
  if (taxRate === undefined || whtRate === undefined || pricesIncludeVat === undefined) {
    const { data: settings, error } = await supabase.from("org_settings")
      .select("vat_registered, vat_rate_bps, wht_rate_bps, prices_include_vat").eq("org_id", ctx.orgId).maybeSingle()
    if (error) return { error: error.message }
    taxRate ??= settings?.vat_registered ? settings.vat_rate_bps : 0
    whtRate ??= settings?.wht_rate_bps ?? 0
    pricesIncludeVat ??= settings?.prices_include_vat ?? false
  }
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
      product_id: d.product_id ?? null,
      unit: unit ?? "period",
      tax_rate_bps: taxRate,
      wht_rate_bps: whtRate,
      prices_include_vat: pricesIncludeVat,
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
  ...taxFields,
  id: z.guid(),
  client_id: z.guid("Client is required"),
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
  const { error } = await supabase.rpc("update_subscription_schedule", {
    p_org_id: ctx.orgId,
    p_subscription_id: d.id,
    p_start_date: d.start_date ?? null,
    p_changes: {
      client_id: d.client_id,
      project_id: d.project_id,
      name: d.name,
      amount_satang: bahtToSatang(d.amountBaht),
      interval: d.interval,
      notes: d.notes,
      product_id: d.product_id,
      unit: d.unit,
      tax_rate_bps: d.tax_rate_bps,
      wht_rate_bps: d.wht_rate_bps,
      prices_include_vat: d.prices_include_vat,
    },
  })

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
  id: z.guid(),
  status: z.enum(SUBSCRIPTION_STATUSES),
  bill_missed_periods: z.boolean().default(false),
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
  const { error } = await supabase.rpc("update_subscription_schedule", {
    p_org_id: ctx.orgId,
    p_subscription_id: d.id,
    p_start_date: null,
    p_status: d.status,
    p_bill_missed_periods: d.bill_missed_periods,
  })

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: d.id,
    action: "status_changed",
    summary: `Set subscription status to ${d.status}`,
    meta: { status: d.status, billMissedPeriods: d.bill_missed_periods },
  })

  revalidatePath("/finance/subscriptions")
  revalidatePath(`/finance/subscriptions/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const DeleteSubscription = z.object({ id: z.guid() })

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

const GenerateNow = z.object({ id: z.guid(), occurrence: z.iso.date() })

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
