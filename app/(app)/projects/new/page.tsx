import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { createProject } from "../actions"
import {
  ProjectForm,
  type ProjectFormValues,
  type ClientOption,
} from "../_components/project-form"

export const dynamic = "force-dynamic"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{ dealId?: string; clientId?: string }>
}) {
  await requireOrgContext()
  const { dealId, clientId } = await searchParams
  const supabase = await createClient()

  const { data: clientsData } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true })
  const clients = (clientsData ?? []) as ClientOption[]

  // Prefill from a deal when arriving from CRM.
  let prefill: Partial<ProjectFormValues> = {}
  let resolvedDealId: string | null = null

  if (dealId) {
    const { data: deal } = await supabase
      .from("deals")
      .select("id, title, client_id, value_satang")
      .eq("id", dealId)
      .maybeSingle()
    if (deal) {
      resolvedDealId = deal.id
      prefill = {
        name: deal.title,
        clientId: deal.client_id ?? "none",
        budgetBaht: satangToBaht(deal.value_satang ?? 0),
      }
    }
  } else if (clientId) {
    prefill = { clientId }
  }

  // Bind dealId server-side so the client never supplies it.
  async function action(values: ProjectFormValues) {
    "use server"
    return createProject({
      ...values,
      dealId: resolvedDealId ?? undefined,
    })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New project"
        description={
          resolvedDealId
            ? "Prefilled from a won deal — review and create."
            : "Set up a new delivery project."
        }
      >
        <Button variant="outline" render={<Link href="/projects" />}>
          <ArrowLeft data-icon="inline-start" /> Back
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <ProjectForm
            action={action}
            clients={clients}
            defaultValues={prefill}
          />
        </CardContent>
      </Card>
    </div>
  )
}
