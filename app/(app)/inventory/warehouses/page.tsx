import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { inventoryData } from "@/lib/inventory/queries"
import { deleteWarehouse, setNegativeStock } from "@/lib/inventory/actions"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { WarehouseForm } from "../_components/forms"
import { InventoryAction } from "../_components/action-button"

export const dynamic = "force-dynamic"
export default async function WarehousesPage() {
  const ctx = await requireOrgContext()
  const manage = can(ctx.role, "inventory:manage")
  const { warehouses } = await inventoryData()
  const db = await createClient()
  const { data: settings, error } = await db.from("org_settings").select("allow_negative_stock").eq("org_id", ctx.orgId).maybeSingle()
  if (error) throw new Error("Stock policy unavailable")
  return <div className="space-y-6"><PageHeader title="Warehouses" description="Choose one active default warehouse for receipts and deliveries." />
    <div className="rounded-lg border p-4 space-y-3"><p>Negative stock is {settings?.allow_negative_stock ? "allowed" : "blocked"}.</p>{manage && <InventoryAction label={settings?.allow_negative_stock ? "Block negative stock" : "Allow negative stock"} action={setNegativeStock.bind(null, !settings?.allow_negative_stock)} />}</div>
    {warehouses.map(w => <section key={w.id} aria-label={w.name} className="space-y-3"><p>{w.code} · {w.name} {w.is_default && <Badge>Default</Badge>} {!w.active && <Badge variant="outline">Inactive</Badge>}</p>{manage ? <><WarehouseForm warehouse={w} /><InventoryAction action={deleteWarehouse.bind(null, w.id)} label={`Delete ${w.name}`} /></> : <p>{w.address}</p>}</section>)}
    {manage && <WarehouseForm />}
  </div>
}
