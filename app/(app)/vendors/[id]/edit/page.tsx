import { requireCapability, requireOrgContext } from "@/lib/auth"
import { vendorDetail } from "@/lib/purchasing/queries"
import { PageHeader } from "@/components/page-header"
import { VendorForm } from "../../_components/vendor-form"

export default async function EditVendorPage({ params }: { params: Promise<{ id: string }> }) {
  requireCapability(await requireOrgContext(), "purchase:manage")
  const { vendor } = await vendorDetail((await params).id)
  return <div className="space-y-6"><PageHeader title={`Edit ${vendor.name}`} description="Update supplier details and payment terms." /><VendorForm vendor={vendor} /></div>
}
