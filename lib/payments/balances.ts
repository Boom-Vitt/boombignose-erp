import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { readAllOrThrow } from "@/lib/supabase/read-all"

export async function invoiceBalances(supabase: SupabaseClient<Database>, orgId: string) {
  const rows = await readAllOrThrow((from, to) => supabase.from("invoice_balances").select("invoice_id, paid_satang, credited_satang, outstanding_satang").eq("org_id", orgId).order("invoice_id").range(from, to))
  return new Map(rows.map(row => [row.invoice_id, row]))
}
