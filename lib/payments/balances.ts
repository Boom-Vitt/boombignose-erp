import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { readAllOrThrow } from "@/lib/supabase/read-all"

export async function invoiceBalances(supabase: SupabaseClient<Database>, orgId: string) {
  const rows = await readAllOrThrow((from, to) => supabase.from("invoice_balances").select("invoice_id, paid_satang, credited_satang, outstanding_satang").eq("org_id", orgId).order("invoice_id").range(from, to))
  return new Map(rows.map(row => [row.invoice_id, row]))
}

export async function creditNoteRevenue(supabase: SupabaseClient<Database>, orgId: string) {
  return readAllOrThrow((from, to) => supabase.from("credit_note_revenue").select("id, invoice_id, issue_date, project_id, client_name, base_satang, total_satang").eq("org_id", orgId).order("id").range(from, to))
}
