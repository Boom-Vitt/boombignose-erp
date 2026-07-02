"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { bahtToSatang, formatTHB } from "@/lib/money"
import { writeAudit } from "@/lib/audit"

const PRODUCT_KINDS = ["service", "good"] as const

/** Empty string from an optional <input> → undefined (so zod .optional() applies). */
const optionalString = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined))

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

const CreateProduct = z.object({
  name: z.string().trim().min(1, "Name is required"),
  description: optionalString,
  kind: z.enum(PRODUCT_KINDS).default("service"),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

export async function createProduct(
  input: z.input<typeof CreateProduct>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "template:manage")
  } catch {
    return { error: "You do not have permission to manage the catalog." }
  }
  const parsed = CreateProduct.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .insert({
      org_id: ctx.orgId,
      name: d.name,
      description: d.description ?? null,
      kind: d.kind,
      unit_price_satang: bahtToSatang(d.unitPriceBaht),
      active: true,
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "product",
    entityId: data.id,
    action: "created",
    summary: `Added catalog ${d.kind} "${d.name}" at ${formatTHB(
      bahtToSatang(d.unitPriceBaht)
    )}`,
    meta: { kind: d.kind },
  })

  revalidatePath("/products")
  redirect(`/products/${data.id}`)
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

const UpdateProduct = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1, "Name is required"),
  description: optionalString,
  kind: z.enum(PRODUCT_KINDS),
  unitPriceBaht: z.coerce.number().min(0, "Unit price must be 0 or more"),
})

export async function updateProduct(
  input: z.input<typeof UpdateProduct>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "template:manage")
  } catch {
    return { error: "You do not have permission to manage the catalog." }
  }
  const parsed = UpdateProduct.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("products")
    .update({
      name: d.name,
      description: d.description ?? null,
      kind: d.kind,
      unit_price_satang: bahtToSatang(d.unitPriceBaht),
    })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "product",
    entityId: d.id,
    action: "updated",
    summary: `Updated catalog item "${d.name}"`,
  })

  revalidatePath("/products")
  revalidatePath(`/products/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Activate / deactivate
// ---------------------------------------------------------------------------

const SetProductActive = z.object({
  id: z.string().min(1),
  active: z.coerce.boolean(),
})

export async function setProductActive(
  input: z.input<typeof SetProductActive>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "template:manage")
  } catch {
    return { error: "You do not have permission to manage the catalog." }
  }
  const parsed = SetProductActive.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }
  const d = parsed.data

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("products")
    .update({ active: d.active })
    .eq("id", d.id)
    .eq("org_id", ctx.orgId)
    .select("name")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "product",
    entityId: d.id,
    action: d.active ? "activated" : "deactivated",
    summary: `${d.active ? "Reactivated" : "Deactivated"} catalog item "${data.name}"`,
  })

  revalidatePath("/products")
  revalidatePath(`/products/${d.id}`)
  return {}
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

const DeleteProduct = z.object({ id: z.string().min(1) })

export async function deleteProduct(
  input: z.input<typeof DeleteProduct>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "template:manage")
  } catch {
    return { error: "You do not have permission to manage the catalog." }
  }
  const parsed = DeleteProduct.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("products")
    .delete()
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "product",
    entityId: parsed.data.id,
    action: "deleted",
    summary: "Deleted a catalog item",
  })

  revalidatePath("/products")
  redirect("/products")
}
