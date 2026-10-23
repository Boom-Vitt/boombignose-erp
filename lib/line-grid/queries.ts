import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { toGridRows, type DocumentKind, type GridRow, type ServerLine } from "./grid"

type Db = SupabaseClient<Database>
const PARENT = { quote: "quote_id", invoice: "invoice_id", purchase_order: "purchase_order_id" } as const

/** A document's lines and sections in display order, the shape the grid edits. */
export async function gridRows(db: Db, orgId: string, document: DocumentKind, id: string): Promise<GridRow[]> {
  const [lines, sections] = await Promise.all([
    documentLines(db, orgId, document, id),
    readAllOrThrow((from, to) => db.from("document_sections").select("id, kind, description, lines_before, position")
      .eq("org_id", orgId).eq(PARENT[document], id).order("position").order("id").range(from, to)),
  ])
  return toGridRows(lines, sections)
}

async function documentLines(db: Db, orgId: string, document: DocumentKind, id: string): Promise<ServerLine[]> {
  if (document === "purchase_order") {
    const rows = await readAllOrThrow((from, to) => db.from("purchase_order_items")
      .select("id, product_id, description, quantity, unit, unit_cost_satang, received_quantity, returned_quantity, billed_quantity")
      .eq("org_id", orgId).eq("purchase_order_id", id).order("position").order("id").range(from, to))
    return rows.map(row => ({ ...row, unit_price_satang: row.unit_cost_satang, extras: [row.received_quantity, row.returned_quantity, row.billed_quantity].map(value => String(Number(value))) }))
  }
  if (document === "quote") {
    const rows = await readAllOrThrow((from, to) => db.from("quote_items")
      .select("id, product_id, description, quantity, unit, unit_price_satang, tax_rate_bps, invoiced_quantity")
      .eq("org_id", orgId).eq("quote_id", id).order("position").order("id").range(from, to))
    return rows.map(row => ({ ...row, extras: [String(Number(row.invoiced_quantity))] }))
  }
  return readAllOrThrow((from, to) => db.from("invoice_items")
    .select("id, product_id, description, quantity, unit, unit_price_satang, tax_rate_bps")
    .eq("org_id", orgId).eq("invoice_id", id).order("position").order("id").range(from, to))
}
