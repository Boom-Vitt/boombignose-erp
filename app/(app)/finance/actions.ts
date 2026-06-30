"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireRole } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"

const INVOICE_STATUSES = [
  "draft",
  "sent",
  "partially_paid",
  "paid",
  "overdue",
  "cancelled",
] as const

const RECURRING_INTERVALS = ["weekly", "monthly", "quarterly", "yearly"] as const

const COST_CATEGORIES = [
  "software",
  "contractor",
  "infra",
  "marketing",
  "salary",
  "other",
] as const

const PAYMENT_METHODS = [
  "transfer",
  "cash",
  "card",
  "promptpay",
  "cheque",
  "other",
] as const

/** Empty string from an optional <input> → undefined (so zod .optional() applies). */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

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

// ---------------------------------------------------------------------------
// Invoices
// ---------------------------------------------------------------------------

const CreateInvoice = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: z.string().trim().min(1, "Invoice number is required"),
  status: z.enum(INVOICE_STATUSES).default("draft"),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  is_recurring: z.coerce.boolean().default(false),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function createInvoice(
  input: z.input<typeof CreateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("invoices")
    .insert({
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
      number: d.number,
      status: d.status,
      issue_date: d.issue_date ?? undefined,
      due_date: d.due_date,
      amount_satang: bahtToSatang(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/finance")
  redirect(`/finance/invoices/${data.id}`)
}

const UpdateInvoice = z.object({
  id: z.string().min(1),
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: z.string().trim().min(1, "Invoice number is required"),
  status: z.enum(INVOICE_STATUSES),
  issue_date: optionalDate,
  due_date: optionalDate,
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  is_recurring: z.coerce.boolean(),
  recurring_interval: z.enum(RECURRING_INTERVALS).nullish(),
  notes: optionalString,
})

export async function updateInvoice(
  input: z.input<typeof UpdateInvoice>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = UpdateInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("invoices")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      number: d.number,
      status: d.status,
      issue_date: d.issue_date ?? undefined,
      due_date: d.due_date,
      amount_satang: bahtToSatang(d.amountBaht),
      is_recurring: d.is_recurring,
      recurring_interval: d.is_recurring ? (d.recurring_interval ?? null) : null,
      notes: d.notes,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Payments (with invoice status recompute)
// ---------------------------------------------------------------------------

const RecordPayment = z.object({
  invoice_id: z.string().min(1),
  amountBaht: z.coerce.number().positive("Amount must be greater than 0"),
  paid_at: optionalDate,
  method: z.enum(PAYMENT_METHODS).default("transfer"),
  notes: optionalString,
})

export async function recordPayment(
  input: z.input<typeof RecordPayment>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = RecordPayment.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // Load the invoice (amount + current stored status) to recompute after insert.
  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .select("id, amount_satang, status")
    .eq("id", d.invoice_id)
    .eq("org_id", ctx.orgId)
    .single()

  if (invErr || !invoice) return { error: "Invoice not found" }

  // Insert the payment.
  const { error: payErr } = await supabase.from("payments").insert({
    org_id: ctx.orgId,
    invoice_id: d.invoice_id,
    amount_satang: bahtToSatang(d.amountBaht),
    paid_at: d.paid_at ?? undefined,
    method: d.method,
    notes: d.notes,
  })

  if (payErr) return { error: payErr.message }

  // Recompute total paid from all payments on this invoice.
  const { data: payments, error: sumErr } = await supabase
    .from("payments")
    .select("amount_satang")
    .eq("invoice_id", d.invoice_id)
    .eq("org_id", ctx.orgId)

  if (sumErr) return { error: sumErr.message }

  const totalPaid = (payments ?? []).reduce((acc, p) => acc + p.amount_satang, 0)

  // Only transition sent/partially_paid/paid/overdue invoices. Leave draft/cancelled as-is.
  if (invoice.status !== "draft" && invoice.status !== "cancelled") {
    let nextStatus = invoice.status
    if (invoice.amount_satang > 0 && totalPaid >= invoice.amount_satang) {
      nextStatus = "paid"
    } else if (totalPaid > 0) {
      nextStatus = "partially_paid"
    }

    if (nextStatus !== invoice.status) {
      const { error: updErr } = await supabase
        .from("invoices")
        .update({ status: nextStatus })
        .eq("id", d.invoice_id)
        .eq("org_id", ctx.orgId)
      if (updErr) return { error: updErr.message }
    }
  }

  revalidatePath("/finance")
  revalidatePath(`/finance/invoices/${d.invoice_id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Costs
// ---------------------------------------------------------------------------

const CreateCost = z.object({
  category: z.enum(COST_CATEGORIES).default("other"),
  amountBaht: z.coerce.number().min(0, "Amount must be 0 or more"),
  incurred_on: optionalDate,
  vendor: optionalString,
  project_id: optionalId,
  notes: optionalString,
})

export async function createCost(
  input: z.input<typeof CreateCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("costs").insert({
    org_id: ctx.orgId,
    category: d.category,
    amount_satang: bahtToSatang(d.amountBaht),
    incurred_on: d.incurred_on ?? undefined,
    vendor: d.vendor,
    project_id: d.project_id,
    notes: d.notes,
  })

  if (error) return { error: error.message }

  revalidatePath("/finance")
  redirect("/finance")
}

const DeleteCost = z.object({ id: z.string().min(1) })

export async function deleteCost(
  input: z.input<typeof DeleteCost>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireRole(ctx, ["owner", "admin"])
  } catch {
    return { error: "Only owners and admins can delete costs." }
  }
  const parsed = DeleteCost.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("costs")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/finance")
  return {}
}
