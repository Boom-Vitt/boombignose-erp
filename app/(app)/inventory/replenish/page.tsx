import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { readReplenishmentPlan } from "@/lib/inventory/replenishment"
import { todayISO } from "@/lib/dates"
import { can } from "@/lib/permissions"
import { inventoryData } from "@/lib/inventory/queries"
import { replenishmentGroups, replenishmentQuantity } from "@/lib/inventory/math"
import { createReplenishment } from "@/lib/inventory/actions"
import { PageHeader } from "@/components/page-header"
import { ReorderForm } from "../_components/forms"
import { InventoryAction } from "../_components/action-button"

export const dynamic = "force-dynamic"
export default async function ReplenishPage() {
  const ctx = await requireOrgContext()
  const manage = can(ctx.role, "inventory:manage")
  const { products, vendors } = await inventoryData()
  const db = await createClient()
  const preview = await readReplenishmentPlan(db, ctx.orgId, todayISO())
  const active = products.filter(p => p.active)
  const groups = replenishmentGroups(active)
  return <div className="space-y-6"><PageHeader title="Replenishment" description="Forecast stock includes on hand and the remaining quantities on open purchase orders." />
    <section aria-label="Replenishment dry-run preview" className="rounded-lg border p-4"><h2 className="font-semibold">Dry-run preview</h2><p>No purchase orders are created by this preview.</p><ul>{preview.map(line => <li key={line.product_id}>{line.product_name} · Order {line.order_quantity} {line.unit} · Lead {line.lead_days} days · Expected {line.expected_date}</li>)}</ul></section>
    {groups.length === 0 && <p>No products require replenishment.</p>}
    {groups.map(group => {
      const vendor = vendors.find(v => v.id === group.vendorId)
      return <section key={group.vendorId ?? "unassigned"} className="space-y-3 rounded-xl border p-5"><h2 className="font-semibold">{vendor?.name ?? "Unassigned vendor"}</h2><ul className="space-y-2">{group.products.map(p => <li key={p.id}>{p.name} · On hand {p.quantity} {p.unit} · On order {p.on_order} · Forecast {p.quantity + p.on_order} · Minimum {p.reorder_min} · Order {replenishmentQuantity(p)}</li>)}</ul>{manage && vendor?.active && group.products.some(p => p.reorder_qty > 0) && <InventoryAction label="Create RFQ" variant="default" action={createReplenishment.bind(null, vendor.id)} />}{!vendor?.active && <p className="text-sm text-muted-foreground">Choose an active default vendor before creating an RFQ.</p>}</section>
    })}
    {manage && <section className="space-y-3"><h2 className="font-semibold">Replenishment rules</h2>{active.map(product => <ReorderForm key={product.id} product={product} vendors={vendors.filter(v => v.active)} />)}</section>}
  </div>
}
