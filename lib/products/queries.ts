import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import type { ProductOption } from "./snapshot"

export async function activeProductOptions(): Promise<ProductOption[]> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data, error } = await supabase.from("products")
    .select("id, sku, name, description, unit, list_price_satang")
    .eq("org_id", ctx.orgId).eq("active", true).order("name")
  if (error) throw new Error(error.message)
  return data
}
