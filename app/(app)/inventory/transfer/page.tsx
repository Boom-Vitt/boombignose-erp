import { requireCapability, requireOrgContext } from "@/lib/auth"
import { inventoryData } from "@/lib/inventory/queries"
import { PageHeader } from "@/components/page-header"
import { TransferForm } from "../_components/transfer-form"

export default async function TransferPage() {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "inventory:manage")
  const { products, warehouses } = await inventoryData()
  return <div className="space-y-6"><PageHeader title="Warehouse transfer" description="Move stock atomically at its retained average cost." /><TransferForm products={products} warehouses={warehouses} scope={`${ctx.orgId}/${ctx.userId}`} /></div>
}
