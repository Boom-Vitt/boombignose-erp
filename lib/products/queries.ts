"use server"

import { createClient } from "@/lib/supabase/server"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import type { ProductOption } from "./snapshot"
import { productSearchFilter } from "./search"
import { z } from "zod"

/** `withCost` adds the purchase cost for purchase lines, so it needs purchase rights. */
export async function activeProductOptions(search: string = "", withCost = false): Promise<ProductOption[]> {
  const ctx = await requireOrgContext()
  if (withCost) requireCapability(ctx, "purchase:manage")
  const term = z.string().trim().max(200).parse(search)
  const supabase = await createClient()
  let query = supabase.from("products")
    .select("id, sku, name, description, unit, list_price_satang, tax_rate_bps, cost_satang")
    .eq("org_id", ctx.orgId).eq("active", true).order("name").order("id").limit(20)
  if (term) query = query.or(productSearchFilter(term))
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return withCost ? data : data.map(product => ({ ...product, cost_satang: undefined }))
}
