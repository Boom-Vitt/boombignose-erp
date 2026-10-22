"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import { ProductLineInput } from "@/lib/products/schema"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { nextDocumentNumber } from "@/lib/documents/numbering"
import {
  quoteTransitionError,
  quoteIsEditable,
  serviceMoneyInput,
  serviceQuantityInput,
  serviceAmountSatang,
  serviceLineAmount,
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

  // Auto-generate the quote number when none was provided. Scans the org's
  // existing numbers for the current year and continues the running counter.
  // Manual numbers are used verbatim; a rare unique(org_id, number) collision
  // surfaces as the DB error below, exactly as before.
  let number = d.number
  if (!number) {
    const year = Number(todayISO().slice(0, 4))
    const { data: existing } = await supabase
      .from("quotes")
      .select("number")
      .eq("org_id", ctx.orgId)
    number = nextDocumentNumber(
      "QUO",
      (existing ?? []).map((r) => r.number),
      year
    )
  }

  const { data, error } = await supabase
    .from("quotes")
    .insert({
      org_id: ctx.orgId,
      client_id: d.client_id,
      project_id: d.project_id,
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
// Quote items (database recomputes exact totals atomically)
// ---------------------------------------------------------------------------

const AddQuoteItem = z.object({
  ...ProductLineInput.shape,
  quote_id: z.string().min(1),
  description: z.string().trim().min(1, "Description is required"),
  quantity: serviceQuantityInput,
  unitPriceBaht: serviceMoneyInput,
}).refine((item) => {
  try { serviceLineAmount(item.quantity, serviceAmountSatang(item.unitPriceBaht)); return true } catch { return false }
}, "Line amount outside safe satang bounds")

export async function addQuoteItem(
  input: z.input<typeof AddQuoteItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = AddQuoteItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // Accepted scope and terminal quotes are frozen by the database as well.
  const { data: parent, error: parentErr } = await supabase
    .from("quotes")
    .select("status")
    .eq("id", d.quote_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (!parent) return { error: "Quote not found" }
  if (!quoteIsEditable(parent.status)) {
    return { error: "This quote is locked" }
  }

  // Next position = current item count (stable append order).
  const { count } = await supabase
    .from("quote_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", d.quote_id)
    .eq("org_id", ctx.orgId)

  const unitPriceSatang = serviceAmountSatang(d.unitPriceBaht)
  if (d.product_id) {
    const { data: product, error: productError } = await supabase.from("products").select("id")
      .eq("org_id", ctx.orgId).eq("id", d.product_id).eq("active", true).maybeSingle()
    if (productError) return { error: productError.message }
    if (!product) return { error: "Product unavailable. Choose an active product or a free-text line." }
  }
  const { error } = await supabase.from("quote_items").insert({
    org_id: ctx.orgId,
    quote_id: d.quote_id,
    description: d.description,
    product_id: d.product_id ?? null,
    unit: d.unit ?? null,
    quantity: d.quantity,
    unit_price_satang: unitPriceSatang,
    amount_satang: serviceLineAmount(d.quantity, unitPriceSatang),
    position: count ?? 0,
  })

  if (error) return { error: error.message }

  revalidatePath(`/quotes/${d.quote_id}`)
  return {}
}

const DeleteQuoteItem = z.object({ id: z.string().min(1) })

export async function deleteQuoteItem(
  input: z.input<typeof DeleteQuoteItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DeleteQuoteItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()

  // Resolve the parent so agreed scope cannot be edited after acceptance.
  const { data: item, error: findErr } = await supabase
    .from("quote_items")
    .select("id, quote_id")
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (findErr) return { error: findErr.message }
  if (!item) return { error: "Line item not found" }

  const { data: parent, error: parentErr } = await supabase
    .from("quotes")
    .select("status")
    .eq("id", item.quote_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (!parent) return { error: "Quote not found" }
  if (!quoteIsEditable(parent.status)) {
    return { error: "This quote is locked" }
  }

  const { error } = await supabase
    .from("quote_items")
    .delete()
    .eq("id", item.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath(`/quotes/${item.quote_id}`)
  return {}
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
  const parsed = SetQuoteStatus.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

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

const ConvertQuote = z.object({ id: z.guid(), key: z.uuid() })

export async function convertQuoteToInvoice(
  input: z.input<typeof ConvertQuote>
): Promise<{ error?: string }> {
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
  })
  if (error) return { error: error.message }
  if (!invoiceId) return { error: "Conversion did not return an invoice. Retry this request." }

  // The transaction owns project, milestone, invoice, lines, source links and audit.
  revalidatePath("/quotes")
  revalidatePath(`/quotes/${parsed.data.id}`)
  revalidatePath("/projects")
  revalidatePath("/finance")
  redirect(`/finance/invoices/${invoiceId}`)
}
