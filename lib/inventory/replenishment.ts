import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { readAllOrThrow } from "@/lib/supabase/read-all"

export function readReplenishmentPlan(db: SupabaseClient<Database>, orgId: string, date: string) {
  return readAllOrThrow(async (from, to) => {
    const { data, error } = await db.rpc("replenishment_plan", { p_org_id: orgId, p_date: date }).order("product_id").range(from, to)
    return { data: data?.map(line => ({ ...line, id: line.product_id })) ?? null, error }
  })
}
