import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { Constants } from "@/lib/types/database"
import { DealForm, type DealFormValues } from "../_components/deal-form"
import { createDeal } from "../actions"

export const dynamic = "force-dynamic"

export default async function NewDealPage({
  searchParams,
}: {
  searchParams: Promise<{ title?: string; amount?: string; stage?: string; clientId?: string }>
}) {
  const ctx = await requireOrgContext()
  const q = await searchParams
  const supabase = await createClient()
  const { data: clients } = await supabase
    .from("clients")
    .select("id,name")
    .eq("org_id", ctx.orgId)
    .order("name")

  // Prefill from the board's quick create ("Edit"); absent params fall back to the form defaults.
  const amount = Number(q.amount)
  const defaultValues: Partial<DealFormValues> = {
    title: q.title ?? "",
    valueBaht: amount > 0 ? amount : 0,
    clientId: q.clientId ?? "",
    stage: Constants.public.Enums.deal_stage.find((s) => s === q.stage) ?? "lead",
  }

  return (
    <div className="space-y-6">
      <PageHeader title="New deal" description="Add a deal to your pipeline." />
      <Card className="max-w-2xl">
        <CardContent>
          <DealForm
            clients={clients ?? []}
            action={createDeal}
            defaultValues={defaultValues}
            submitLabel="Create deal"
          />
        </CardContent>
      </Card>
    </div>
  )
}
