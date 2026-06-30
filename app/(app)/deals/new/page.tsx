import { createClient } from "@/lib/supabase/server"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { DealForm } from "../_components/deal-form"
import { createDeal } from "../actions"

export const dynamic = "force-dynamic"

export default async function NewDealPage() {
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
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
