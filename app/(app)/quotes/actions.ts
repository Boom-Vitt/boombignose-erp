"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import {
  quoteTransitionError,
  quoteIsEditable,
  serviceMoneyInput,
  serviceQuantityInput,
  serviceAmountSatang,
} from "@/lib/workflows/service"

const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
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
// Quotes
// ---------------------------------------------------------------------------

const CreateQuote = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  deal_id: optionalId,
  number: optionalString,
  issue_date: optionalDate,
  valid_until: optionalDate,
  discountBaht: serviceMoneyInput.default(0),
  notes: optionalString,
})

export async function createQuote(
  input: z.input<typeof CreateQuote>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = CreateQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  let number = d.number
  if (!number) {
    const year = Number(todayISO().slice(0, 4))
    const { data: reserved, error: numberError } = await supabase.rpc("reserve_document_number", {
      p_org_id: ctx.orgId, p_kind: "quote", p_year: year,
    })
    if (numberError) return { error: numberError.message }
    if (!reserved) return { error: "Could not reserve a quote number. Please retry." }
    number = reserved
  }

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
      deal_id: d.deal_id,
      number,
      status: "draft",
      issue_date: d.issue_date ?? undefined,
      valid_until: d.valid_until,
      discount_satang: serviceAmountSatang(d.discountBaht),
      subtotal_satang: 0,
      total_satang: 0,
      notes: d.notes,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "quote",
    entityId: data.id,
    action: "created",
    summary: `Created quote ${number}`,
  })

  revalidatePath("/quotes")
  redirect(`/quotes/${data.id}`)
}

const UpdateQuote = z.object({
  id: z.string().min(1),
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  deal_id: optionalId,
  // The shared form marks number optional (create auto-numbers). On edit the
  // field is prefilled, so a blank number simply leaves the stored one untouched.
  number: optionalString,
  issue_date: optionalDate,
  valid_until: optionalDate,
  discountBaht: serviceMoneyInput,
  notes: optionalString,
})

export async function updateQuote(
  input: z.input<typeof UpdateQuote>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const parsed = UpdateQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data: current, error: readError } = await supabase
    .from("quotes")
    .select("status")
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()
  if (readError) return { error: readError.message }
  if (!current) return { error: "Quote not found" }
  if (!quoteIsEditable(current.status)) return { error: "This quote is locked" }

  const { error } = await supabase
    .from("quotes")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      deal_id: d.deal_id,
      ...(d.number ? { number: d.number } : {}),
      issue_date: d.issue_date ?? undefined,
      valid_until: d.valid_until,
      discount_satang: serviceAmountSatang(d.discountBaht),
      notes: d.notes,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/quotes")
  revalidatePath(`/quotes/${d.id}`)
  return {}
}

const DeleteQuote = z.object({ id: z.string().min(1) })

export async function deleteQuote(
  input: z.input<typeof DeleteQuote>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "quote:delete")
  } catch {
    return { error: "Only owners and admins can delete quotes." }
  }
  const parsed = DeleteQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("quotes")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "quote",
    entityId: parsed.data.id,
    action: "deleted",
    summary: "Deleted a quote",
  })

  revalidatePath("/quotes")
  redirect("/quotes")
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

const SetQuoteStatus = z.object({
  id: z.string().min(1),
  status: z.enum(QUOTE_STATUSES),
})

export async function setQuoteStatus(
  input: z.input<typeof SetQuoteStatus>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "record:write")
  const parsed = SetQuoteStatus.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  if (d.status === "accepted") {
    try { requireCapability(ctx, "quote:convert") }
    catch { return { error: "Only owners and admins can accept quotes." } }
  }

  const supabase = await createSupabaseClient()
  const { data: current, error: readError } = await supabase
    .from("quotes")
    .select("status, valid_until")
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()
  if (readError) return { error: readError.message }
  if (!current) return { error: "Quote not found" }
  const transitionError = quoteTransitionError(current.status, d.status, current.valid_until, todayISO())
  if (transitionError) return { error: transitionError }
  if (current.status === d.status) return {}

  const { data: quote, error } = await supabase
    .from("quotes")
    .update({ status: d.status })
    .eq("status", current.status)
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)
    .select("number")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "quote",
    entityId: d.id,
    action: "status_changed",
    summary: `Set quote ${quote.number} to ${d.status}`,
    meta: { status: d.status },
  })

  revalidatePath("/quotes")
  revalidatePath(`/quotes/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Convert to invoice (owner/admin only)
// ---------------------------------------------------------------------------

const ConvertQuote = z.object({
  id: z.guid(),
  key: z.uuid(),
  lines: z.array(z.object({ quote_item_id: z.guid(), quantity: serviceQuantityInput })).min(1).optional(),
  depositSatang: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  depositBps: z.number().int().min(1).max(10000).optional(),
}).refine((input) => [input.lines, input.depositSatang, input.depositBps].filter((value) => value !== undefined).length <= 1,
  "Choose quantities or one deposit mode")
  .refine((input) => !input.lines || new Set(input.lines.map((line) => line.quote_item_id)).size === input.lines.length,
    "Each quote line can only be selected once")

export async function convertQuoteToInvoice(
  input: z.input<typeof ConvertQuote>
): Promise<{ error?: string; rejected?: boolean }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "quote:convert")
  } catch {
    return { error: "Only owners and admins can convert quotes." }
  }
  const parsed = ConvertQuote.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data: invoiceId, error } = await supabase.rpc("convert_accepted_quote", {
    p_org_id: ctx.orgId,
    p_quote_id: parsed.data.id,
    p_key: parsed.data.key,
    ...(parsed.data.lines ? { p_lines: parsed.data.lines } : {}),
    ...(parsed.data.depositSatang !== undefined ? { p_deposit_satang: parsed.data.depositSatang } : {}),
    ...(parsed.data.depositBps !== undefined ? { p_deposit_bps: parsed.data.depositBps } : {}),
  })
  if (error) return { error: error.message, ...(error.code === "P0001" && !["Only owners and admins may convert quotes", "Idempotency conflict"].includes(error.message) ? { rejected: true } : {}) }
  if (!invoiceId) return { error: "Conversion did not return an invoice. Retry this request." }

  // The transaction owns project, milestone, invoice, lines, source links and audit.
  revalidatePath("/quotes")
  revalidatePath(`/quotes/${parsed.data.id}`)
  revalidatePath("/projects")
  revalidatePath("/finance")
  redirect(`/finance/invoices/${invoiceId}`)
}

const CancelQuoteInvoice = z.object({ quoteId: z.guid(), invoiceId: z.guid() })

export async function cancelQuoteInvoice(input: z.input<typeof CancelQuoteInvoice>): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "quote:convert") }
  catch { return { error: "Only owners and admins can cancel quote invoices." } }
  const parsed = CancelQuoteInvoice.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const supabase = await createSupabaseClient()
  const { error } = await supabase.rpc("cancel_quote_invoice", { p_org_id: ctx.orgId, p_invoice_id: parsed.data.invoiceId })
  if (error) return { error: error.message }
  revalidatePath(`/quotes/${parsed.data.quoteId}`)
  revalidatePath("/quotes")
  revalidatePath(`/finance/invoices/${parsed.data.invoiceId}`)
  revalidatePath("/finance")
  return {}
}
