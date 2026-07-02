"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"
import { lineAmountSatang, subtotalSatang } from "@/lib/metrics/line-items"
import { writeAudit } from "@/lib/audit"

// ---------------------------------------------------------------------------
// Invoice line items
//
// Optional, non-invasive line items on the invoice detail page. When an invoice
// has ≥1 line item, its authoritative `amount_satang` is DERIVED from the items
// (recomputed on every add/delete). When it has 0 items the manually-entered
// amount is left untouched, so the create form and older invoices keep working.
// ---------------------------------------------------------------------------

/**
 * Recompute and persist the parent invoice `amount_satang` from its remaining
 * items. When no items remain, the manual amount is intentionally left as-is.
 */
async function recomputeInvoiceAmount(
  supabase: Awaited<ReturnType<typeof createSupabaseClient>>,
  orgId: string,
  invoiceId: string
): Promise<{ error?: string }> {
  const { data: items, error } = await supabase
    .from("invoice_items")
    .select("amount_satang")
    .eq("invoice_id", invoiceId)
    .eq("org_id", orgId)

  if (error) return { error: error.message }
  if (!items || items.length === 0) return {}

  const total = subtotalSatang(items)
  const { error: updErr } = await supabase
    .from("invoices")
    .update({ amount_satang: total })
    .eq("id", invoiceId)
    .eq("org_id", orgId)

  if (updErr) return { error: updErr.message }
  return {}
}

const AddInvoiceItem = z.object({
  invoice_id: z.string().min(1),
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.coerce.number().positive("Quantity must be greater than 0"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

export async function addInvoiceItem(
  input: z.input<typeof AddInvoiceItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = AddInvoiceItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // Position = current item count (org-scoped, this invoice).
  const { count, error: countErr } = await supabase
    .from("invoice_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", d.invoice_id)
    .eq("org_id", ctx.orgId)

  if (countErr) return { error: countErr.message }

  const unitPriceSatang = bahtToSatang(d.unitPriceBaht)
  const { error: insErr } = await supabase.from("invoice_items").insert({
    org_id: ctx.orgId,
    invoice_id: d.invoice_id,
    description: d.description,
    quantity: d.quantity,
    unit_price_satang: unitPriceSatang,
    amount_satang: lineAmountSatang(d.quantity, unitPriceSatang),
    position: count ?? 0,
  })

  if (insErr) return { error: insErr.message }

  const recomputed = await recomputeInvoiceAmount(
    supabase,
    ctx.orgId,
    d.invoice_id
  )
  if (recomputed.error) return { error: recomputed.error }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: d.invoice_id,
    action: "item_added",
    summary: `Added line item "${d.description}" to invoice`,
    meta: { invoiceId: d.invoice_id },
  })

  revalidatePath(`/finance/invoices/${d.invoice_id}`)
  return {}
}

const DeleteInvoiceItem = z.object({ id: z.string().min(1) })

export async function deleteInvoiceItem(
  input: z.input<typeof DeleteInvoiceItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = DeleteInvoiceItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()

  // Resolve the parent invoice (org-scoped) so we can recompute + revalidate.
  const { data: item, error: findErr } = await supabase
    .from("invoice_items")
    .select("id, invoice_id, description")
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (findErr) return { error: findErr.message }
  if (!item) return { error: "Line item not found" }

  const { error: delErr } = await supabase
    .from("invoice_items")
    .delete()
    .eq("id", item.id)
    .eq("org_id", ctx.orgId)

  if (delErr) return { error: delErr.message }

  const recomputed = await recomputeInvoiceAmount(
    supabase,
    ctx.orgId,
    item.invoice_id
  )
  if (recomputed.error) return { error: recomputed.error }

  await writeAudit(ctx, {
    entity: "invoice",
    entityId: item.invoice_id,
    action: "item_deleted",
    summary: `Removed line item "${item.description}" from invoice`,
    meta: { invoiceId: item.invoice_id },
  })

  revalidatePath(`/finance/invoices/${item.invoice_id}`)
  return {}
}
