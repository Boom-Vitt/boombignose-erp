import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { DealForm } from "../_components/deal-form"
import { createDeal } from "../actions"

export const dynamic = "force-dynamic"

export default async function NewDealPage() {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .eq("org_id", ctx.orgId)
    .order("name")

  return (
    <div className="space-y-6">
      <PageHeader title="New deal" description="Add a deal to your pipeline." />
      <Card className="max-w-2xl">
        <CardContent>
          <DealForm clients={clients ?? []} action={createDeal} submitLabel="Create deal" />
        </CardContent>
      </Card>
    </div>
  )
}
