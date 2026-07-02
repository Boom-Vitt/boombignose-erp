"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang, formatTHBWhole } from "@/lib/money"
import {
  lineAmountSatang,
  subtotalSatang,
  documentTotalSatang,
} from "@/lib/metrics/line-items"
import { writeAudit } from "@/lib/audit"
import { todayISO } from "@/lib/dates"
import { nextDocumentNumber } from "@/lib/documents/numbering"

const QUOTE_STATUSES = [
  "draft",
  "sent",
  "accepted",
  "declined",
  "expired",
  "converted",
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

/**
 * Recompute and persist a quote's subtotal/total from its line items. The quote's
 * own discount drives the total. Runs after any item insert/delete. Returns the
 * error message on failure, or null on success.
 */
async function recomputeQuoteTotals(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  orgId: string,
  quoteId: string
): Promise<string | null> {
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("discount_satang")
    .eq("id", quoteId)
    .eq("org_id", orgId)
    .single()

  if (quoteErr || !quote) return quoteErr?.message ?? "Quote not found"

  const { data: items, error: itemsErr } = await supabase
    .from("quote_items")
    .select("amount_satang")
    .eq("quote_id", quoteId)
    .eq("org_id", orgId)

  if (itemsErr) return itemsErr.message

  const subtotal = subtotalSatang(items ?? [])
  const total = documentTotalSatang(subtotal, quote.discount_satang)

  const { error: updErr } = await supabase
    .from("quotes")
    .update({ subtotal_satang: subtotal, total_satang: total })
    .eq("id", quoteId)
    .eq("org_id", orgId)

  return updErr?.message ?? null
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

const CreateQuote = z.object({
  client_id: z.string().min(1, "Client is required"),
  project_id: optionalId,
  number: optionalString,
  issue_date: optionalDate,
  valid_until: optionalDate,
  discountBaht: z.coerce.number().min(0, "Discount must be 0 or more").default(0),
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
      discount_satang: bahtToSatang(d.discountBaht),
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
  discountBaht: z.coerce.number().min(0, "Discount must be 0 or more"),
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
  const { error } = await supabase
    .from("quotes")
    .update({
      client_id: d.client_id,
      project_id: d.project_id,
      ...(d.number ? { number: d.number } : {}),
      issue_date: d.issue_date ?? undefined,
      valid_until: d.valid_until,
      discount_satang: bahtToSatang(d.discountBaht),
      notes: d.notes,
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  // Discount feeds the total, so recompute after a header edit.
  const recomputeErr = await recomputeQuoteTotals(supabase, ctx.orgId, d.id)
  if (recomputeErr) return { error: recomputeErr }

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
// Quote items (with totals recompute)
// ---------------------------------------------------------------------------

const AddQuoteItem = z.object({
  quote_id: z.string().min(1),
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

export async function addQuoteItem(
  input: z.input<typeof AddQuoteItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = AddQuoteItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // A converted quote is locked: its items are frozen (they've become an invoice).
  const { data: parent, error: parentErr } = await supabase
    .from("quotes")
    .select("status")
    .eq("id", d.quote_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (!parent) return { error: "Quote not found" }
  if (parent.status === "converted") {
    return { error: "This quote is converted and locked" }
  }

  // Next position = current item count (stable append order).
  const { count } = await supabase
    .from("quote_items")
    .select("id", { count: "exact", head: true })
    .eq("quote_id", d.quote_id)
    .eq("org_id", ctx.orgId)

  const unitPriceSatang = bahtToSatang(d.unitPriceBaht)
  const { error } = await supabase.from("quote_items").insert({
    org_id: ctx.orgId,
    quote_id: d.quote_id,
    description: d.description,
    quantity: d.quantity,
    unit_price_satang: unitPriceSatang,
    amount_satang: lineAmountSatang(d.quantity, unitPriceSatang),
    position: count ?? 0,
  })

  if (error) return { error: error.message }

  const recomputeErr = await recomputeQuoteTotals(supabase, ctx.orgId, d.quote_id)
  if (recomputeErr) return { error: recomputeErr }

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

  // Resolve the parent quote first so a converted (locked) quote can't be edited.
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
  if (parent?.status === "converted") {
    return { error: "This quote is converted and locked" }
  }

  const { error } = await supabase
    .from("quote_items")
    .delete()
    .eq("id", item.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  const recomputeErr = await recomputeQuoteTotals(
    supabase,
    ctx.orgId,
    item.quote_id
  )
  if (recomputeErr) return { error: recomputeErr }

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
  const { data: quote, error } = await supabase
    .from("quotes")
    .update({ status: d.status })
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

const ConvertQuote = z.object({ id: z.string().min(1) })

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

  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select(
      "id, number, status, client_id, project_id, total_satang, converted_invoice_id"
    )
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .single()

  if (quoteErr || !quote) return { error: "Quote not found" }
  if (quote.converted_invoice_id) {
    return { error: "This quote has already been converted." }
  }

  const today = todayISO()
  const invoiceNumber = `INV-${quote.number}`

  const { data: invoice, error: invErr } = await supabase
    .from("invoices")
    .insert({
      org_id: ctx.orgId,
      client_id: quote.client_id,
      project_id: quote.project_id,
      number: invoiceNumber,
      status: "draft",
      amount_satang: quote.total_satang,
      issue_date: today,
    })
    .select("id")
    .single()

  if (invErr) return { error: invErr.message }

  // Copy line items across to the new invoice.
  const { data: items, error: itemsErr } = await supabase
    .from("quote_items")
    .select("description, quantity, unit_price_satang, amount_satang, position")
    .eq("quote_id", quote.id)
    .eq("org_id", ctx.orgId)
    .order("position", { ascending: true })

  if (itemsErr) return { error: itemsErr.message }

  if (items && items.length > 0) {
    const { error: copyErr } = await supabase.from("invoice_items").insert(
      items.map((it) => ({
        org_id: ctx.orgId,
        invoice_id: invoice.id,
        description: it.description,
        quantity: it.quantity,
        unit_price_satang: it.unit_price_satang,
        amount_satang: it.amount_satang,
        position: it.position,
      }))
    )
    if (copyErr) return { error: copyErr.message }
  }

  const { error: markErr } = await supabase
    .from("quotes")
    .update({ status: "converted", converted_invoice_id: invoice.id })
    .eq("id", quote.id)
    .eq("org_id", ctx.orgId)

  if (markErr) return { error: markErr.message }

  await writeAudit(ctx, {
    entity: "quote",
    entityId: quote.id,
    action: "converted",
    summary: `Converted quote ${quote.number} to invoice ${invoiceNumber} for ${formatTHBWhole(
      quote.total_satang
    )}`,
    meta: { invoiceId: invoice.id },
  })

  revalidatePath("/quotes")
  revalidatePath(`/quotes/${quote.id}`)
  revalidatePath("/finance")
  redirect(`/finance/invoices/${invoice.id}`)
}
