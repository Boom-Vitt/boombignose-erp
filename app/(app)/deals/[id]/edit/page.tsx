import { notFound } from "next/navigation"

import { createClient } from "@/lib/supabase/server"
import { satangToBaht } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Card, CardContent } from "@/components/ui/card"
import { DealForm, type DealFormValues } from "../../_components/deal-form"
import { DeleteDealButton } from "../../_components/delete-deal-button"
import { updateDeal } from "../../actions"

export const dynamic = "force-dynamic"

export default async function EditDealPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()

  const [{ data: deal }, { data: clients }] = await Promise.all([
    supabase
      .from("deals")
      .select(
        "id,client_id,title,stage,value_satang,expected_close_date,next_follow_up_date,source,notes"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("clients").select("id,name").order("name"),
  ])

  if (!deal) notFound()

  const defaultValues: Partial<DealFormValues> = {
    clientId: deal.client_id,
    title: deal.title,
    stage: deal.stage,
    valueBaht: satangToBaht(deal.value_satang),
    expectedCloseDate: deal.expected_close_date ?? "",
    nextFollowUpDate: deal.next_follow_up_date ?? "",
    source: deal.source ?? "",
    notes: deal.notes ?? "",
  }

  async function action(values: DealFormValues) {
    "use server"
    return updateDeal(id, values)
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit deal" description={deal.title}>
        <DeleteDealButton dealId={deal.id} />
      </PageHeader>
      <Card className="max-w-2xl">
        <CardContent>
          <DealForm
            clients={clients ?? []}
            action={action}
            defaultValues={defaultValues}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  )
}
