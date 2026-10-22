import { requireCapability, requireOrgContext } from "@/lib/auth"
import { inventoryData } from "@/lib/inventory/queries"
import { PageHeader } from "@/components/page-header"
import { CountForm } from "../_components/forms"

export const dynamic = "force-dynamic"
export default async function AdjustPage() {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const { products, warehouses, balances } = await inventoryData()
  return <div className="space-y-6"><PageHeader title="Adjust inventory count" description="Record the physical count and a reason. Corrections append moves to the ledger." /><CountForm key={`${ctx.orgId}/${ctx.userId}`} scope={`${ctx.orgId}/${ctx.userId}`} products={products} warehouses={warehouses.filter(w => w.active)} balances={balances} /></div>
}
