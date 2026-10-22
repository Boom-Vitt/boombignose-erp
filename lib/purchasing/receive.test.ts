import { expect, it, vi } from "vitest"
import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { receivePurchaseStock } from "./receive"

it("posts cumulative quantities through the atomic receipt RPC with an optional warehouse", async () => {
  const rpc = vi.fn().mockResolvedValue({ error: null })
  const db = { rpc } as unknown as SupabaseClient<Database>
  const lines = [{ id: "line", received_quantity: 4, previous_received_quantity: 0 }]
  await receivePurchaseStock(db, "org", "po", lines, "warehouse")
  expect(rpc).toHaveBeenCalledWith("receive_purchase_order", { p_org_id: "org", p_order_id: "po", p_lines: lines, p_warehouse_id: "warehouse" })
  await receivePurchaseStock(db, "org", "po", lines)
  expect(rpc).toHaveBeenLastCalledWith("receive_purchase_order", { p_org_id: "org", p_order_id: "po", p_lines: lines })
})
