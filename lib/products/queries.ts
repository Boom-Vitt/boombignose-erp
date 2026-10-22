"use server"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { ProductOption } from "./snapshot"
import { productSearchFilter } from "./search"
import { z } from "zod"

export async function activeProductOptions(search: string = ""): Promise<ProductOption[]> {
  const ctx = await requireOrgContext()
  const term = z.string().trim().max(200).parse(search)
  const supabase = await createClient()
  let query = supabase.from("products")
    .select("id, sku, name, description, unit, list_price_satang, tax_rate_bps")
    .eq("org_id", ctx.orgId).eq("active", true).order("name").order("id").limit(20)
  if (term) query = query.or(productSearchFilter(term))
  const { data, error } = await query
  if (error) throw new Error(error.message)
  return data
}
