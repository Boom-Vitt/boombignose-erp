"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { ProductLineInput } from "@/lib/products/schema"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { invoiceLineAmount, moneyInput } from "@/lib/payments/input"
import { writeAudit } from "@/lib/audit"

// Invoice item mutation and discounted header recompute are one DB transaction.
// A separate header write can corrupt discounts or leave a persisted line behind.

const AddInvoiceItem = z.object({
  ...ProductLineInput.shape,
  tax_rate_bps: z.number().int().min(0).max(10000).optional(),
  invoice_id: z.string().min(1),
  description: z.string().trim().min(1, "Description is required"),
  quantity: z.string().refine(v => { try { invoiceLineAmount(v, 0); return true } catch { return false } }, "Enter a positive quantity with up to three decimals"),
  unitPriceBaht: z.string().refine(v => { try { moneyInput(v); return true } catch { return false } }, "Enter an exact nonnegative THB price"),
})

export async function addInvoiceItem(
  input: z.input<typeof AddInvoiceItem>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can edit invoice lines." } }
  const parsed = AddInvoiceItem.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()

  // A paid invoice is locked: its items are frozen so the derived amount can't drift.
  const { data: parent, error: parentErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", d.invoice_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (!parent) return { error: "Invoice not found" }
  if (parent.status === "paid") {
    return { error: "This invoice is paid and locked" }
  }

  // Position = current item count (org-scoped, this invoice).
  const { count, error: countErr } = await supabase
    .from("invoice_items")
    .select("id", { count: "exact", head: true })
    .eq("invoice_id", d.invoice_id)
    .eq("org_id", ctx.orgId)

  if (countErr) return { error: countErr.message }

  let taxRate = d.tax_rate_bps
  const unitPriceSatang = moneyInput(d.unitPriceBaht)
  if (d.product_id) {
    const { data: product, error: productError } = await supabase.from("products").select("id, tax_rate_bps")
      .eq("org_id", ctx.orgId).eq("id", d.product_id).eq("active", true).maybeSingle()
    if (productError) return { error: productError.message }
    if (!product) return { error: "Product unavailable. Choose an active product or a free-text line." }
    taxRate ??= product.tax_rate_bps
  }
  if (taxRate === undefined) {
    const { data: settings, error: settingsError } = await supabase.from("org_settings").select("vat_registered, vat_rate_bps").eq("org_id", ctx.orgId).maybeSingle()
    if (settingsError) return { error: settingsError.message }
    taxRate = settings?.vat_registered ? settings.vat_rate_bps : 0
  }
  let amount: number
  try { amount = invoiceLineAmount(d.quantity, unitPriceSatang) }
  catch { return { error: "Line total exceeds safe bounds" } }
  const { error: insErr } = await supabase.from("invoice_items").insert({
    org_id: ctx.orgId,
    invoice_id: d.invoice_id,
    description: d.description,
    product_id: d.product_id ?? null,
    unit: d.unit ?? null,
    tax_rate_bps: taxRate ?? 0,
    quantity: Number(d.quantity),
    unit_price_satang: unitPriceSatang,
    amount_satang: amount,
    position: count ?? 0,
  })

  if (insErr) return { error: insErr.message }

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
  try { requireCapability(ctx, "payment:verify") }
  catch { return { error: "Only owners and admins can edit invoice lines." } }
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

  // A paid invoice is locked: items cannot be removed.
  const { data: parent, error: parentErr } = await supabase
    .from("invoices")
    .select("status")
    .eq("id", item.invoice_id)
    .eq("org_id", ctx.orgId)
    .maybeSingle()

  if (parentErr) return { error: parentErr.message }
  if (parent?.status === "paid") {
    return { error: "This invoice is paid and locked" }
  }

  const { error: delErr } = await supabase
    .from("invoice_items")
    .delete()
    .eq("id", item.id)
    .eq("org_id", ctx.orgId)

  if (delErr) return { error: delErr.message }

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
