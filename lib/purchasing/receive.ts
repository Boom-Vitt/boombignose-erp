import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import type { ReceiptLine } from "./quantities"

/** The database owns the atomic received-total and stock-ledger transaction. */
export function receivePurchaseStock(db: SupabaseClient<Database>, orgId: string, orderId: string, lines: ReceiptLine[], warehouseId?: string) {
  return db.rpc("receive_purchase_order", { p_org_id: orgId, p_order_id: orderId, p_lines: lines, ...(warehouseId ? { p_warehouse_id: warehouseId } : {}) })
}
