"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireRole } from "@/lib/auth"
import { bahtToSatang, formatTHBWhole } from "@/lib/money"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { nextRunAfter } from "@/lib/billing/recurring"
import {
  alreadyGeneratedForPeriod,
  buildGeneratedInvoice,
  invoiceNumberFor,
  isUniqueViolation,
} from "@/lib/billing/generate"

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const
const SUBSCRIPTION_STATUSES = ["active", "paused", "cancelled"] as const

/** Optional id select: "" (none) → null. */
const optionalId = z
  .string()
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
  .string()
  .optional()
  .transform((v) => (v ? v : undefined))

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateSubscription = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  name: z.string().trim().min(1, "Name is required"),
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  interval: z.enum(RECURRING_INTERVALS),
  start_date: optionalDate,
  notes: optionalString,
})

export async function createSubscription(
  input: z.input<typeof CreateSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
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
  id: z.string().min(1),
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  name: z.string().trim().min(1, "Name is required"),
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  interval: z.enum(RECURRING_INTERVALS),
  start_date: optionalDate,
  notes: optionalString,
})

export async function updateSubscription(
  input: z.input<typeof UpdateSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = UpdateSubscription.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("subscriptions")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      name: d.name,
      amount_satang: bahtToSatang(d.amountBaht),
      interval: d.interval,
      start_date: d.start_date ?? undefined,
      notes: d.notes,
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
  id: z.string().min(1),
  status: z.enum(SUBSCRIPTION_STATUSES),
})

export async function setSubscriptionStatus(
  input: z.input<typeof SetStatus>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
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

const DeleteSubscription = z.object({ id: z.string().min(1) })

export async function deleteSubscription(
  input: z.input<typeof DeleteSubscription>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireRole(ctx, ["owner", "admin"])
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

const GenerateNow = z.object({ id: z.string().min(1) })

export async function generateInvoiceNow(
  input: z.input<typeof GenerateNow>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireRole(ctx, ["owner", "admin"])
  } catch {
    return { error: "Only owners and admins can generate invoices." }
  }
  const parsed = GenerateNow.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data: sub, error: loadErr } = await supabase
    .from("subscriptions")
    .select(
      "id, org_id, client_id, project_id, name, amount_satang, interval, next_run_date"
    )
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (loadErr) return { error: loadErr.message }
  if (!sub) return { error: "Subscription not found" }

  const today = todayISO()

  // Idempotency: the invoice number is deterministic per period ("Name-YYYYMM")
  // and `invoices` has unique(org_id, number). If this period was already billed,
  // don't create a second invoice — surface a friendly message instead.
  const number = invoiceNumberFor(sub.name, today)
  const { data: existing, error: existErr } = await supabase
    .from("invoices")
    .select("number")
    .eq("org_id", sub.org_id)
    .eq("number", number)

  if (existErr) return { error: existErr.message }
  if (
    alreadyGeneratedForPeriod(
      (existing ?? []).map((r) => r.number),
      sub.name,
      today
    )
  ) {
    return { error: "An invoice for this period already exists" }
  }

  const invoice = buildGeneratedInvoice(
    {
      org_id: sub.org_id,
      client_id: sub.client_id,
      project_id: sub.project_id,
      name: sub.name,
      amount_satang: sub.amount_satang,
      interval: sub.interval,
    },
    today
  )

  const { data: created, error: insErr } = await supabase
    .from("invoices")
    .insert(invoice)
    .select("id")
    .single()

  if (insErr) {
    // Belt-and-suspenders for a race past the check above.
    if (isUniqueViolation(insErr)) {
      return { error: "An invoice for this period already exists" }
    }
    return { error: insErr.message }
  }

  const { error: advErr } = await supabase
    .from("subscriptions")
    .update({
      last_generated_on: today,
      next_run_date: nextRunAfter(sub.next_run_date, sub.interval, today),
    })
    .eq("id", sub.id)
    .eq("org_id", ctx.orgId)

  if (advErr) return { error: advErr.message }

  await writeAudit(ctx, {
    entity: "subscription",
    entityId: sub.id,
    action: "invoice_generated",
    summary: `Generated invoice ${invoice.number} from subscription ${sub.name}`,
    meta: { invoiceId: created.id },
  })

  revalidatePath("/finance")
  revalidatePath("/finance/subscriptions")
  revalidatePath(`/finance/subscriptions/${sub.id}`)
  return {}
}
