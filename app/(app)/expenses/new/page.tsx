import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { ClaimForm } from "../_components/claim-form"

export default async function NewExpenseClaimPage() {
  await requireOrgContext()
  return <div className="space-y-6">
    <PageHeader title="New expense claim" description="Create a draft, add what you spent, then submit it for approval." breadcrumbs={[{ label: "Expenses", href: "/expenses" }]} />
    <ClaimForm />
  </div>
}
