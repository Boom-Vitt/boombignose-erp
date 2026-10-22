"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { serviceAmountSatang } from "@/lib/workflows/service"
import { ProductInput, type ProductFormValues } from "./schema"
import type { ProductOption } from "./snapshot"

export async function saveProduct(input: ProductFormValues, id?: string): Promise<{ product?: ProductOption; error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "product:manage") }
  catch { return { error: "Only owners and admins can manage products." } }
  const parsed = ProductInput.safeParse(input)
  if (!parsed.success || (id !== undefined && !z.guid().safeParse(id).success)) return { error: "Invalid product input" }
  const d = parsed.data
  const values = {
    sku: d.sku || null,
    name: d.name,
    description: d.description || null,
    type: d.type,
    unit: d.unit,
    list_price_satang: serviceAmountSatang(d.listPriceBaht),
    cost_satang: serviceAmountSatang(d.costBaht),
    tax_rate_bps: d.taxRateBps,
    is_stockable: d.isStockable,
  }
  const supabase = await createClient()
  const mutation = id
    ? supabase.from("products").update(values).eq("org_id", ctx.orgId).eq("id", id)
    : supabase.from("products").insert({ org_id: ctx.orgId, ...values })
  const { data, error } = await mutation.select("id, sku, name, description, unit, list_price_satang, tax_rate_bps").maybeSingle()
  if (error) return { error: error.code === "23505" ? "This SKU is already used in your workspace." : error.message }
  if (!data) return { error: "Product not found" }
  await writeAudit(ctx, {
    entity: "product", entityId: data.id, action: id ? "updated" : "created",
    summary: `${id ? "Updated" : "Created"} product "${data.name}"`,
  })
  revalidatePath("/products")
  revalidatePath(`/products/${data.id}`)
  revalidatePath("/quotes", "layout")
  revalidatePath("/finance/invoices", "layout")
  return { product: data }
}

export async function setProductActive(id: string, active: boolean): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "product:manage") }
  catch { return { error: "Only owners and admins can manage products." } }
  if (!z.guid().safeParse(id).success || typeof active !== "boolean") return { error: "Invalid product input" }
  const supabase = await createClient()
  const { data, error } = await supabase.from("products").update({ active })
    .eq("org_id", ctx.orgId).eq("id", id).select("id, name").maybeSingle()
  if (error) return { error: error.message }
  if (!data) return { error: "Product not found" }
  await writeAudit(ctx, {
    entity: "product", entityId: id, action: active ? "restored" : "archived",
    summary: `${active ? "Restored" : "Archived"} product "${data.name}"`,
  })
  revalidatePath("/products")
  revalidatePath(`/products/${id}`)
  revalidatePath("/quotes", "layout")
  revalidatePath("/finance/invoices", "layout")
  return {}
}
