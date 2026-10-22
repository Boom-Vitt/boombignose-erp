import { requireCapability, requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { VendorForm } from "../_components/vendor-form"

export default async function NewVendorPage() {
  requireCapability(await requireOrgContext(), "purchase:manage")
  return <div className="space-y-6"><PageHeader title="New vendor" description="Add a supplier and payment terms." /><VendorForm /></div>
}
