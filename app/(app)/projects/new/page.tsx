import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { Constants } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { createProject } from "../actions"
import {
  ProjectForm,
  type ProjectFormValues,
  type ClientOption,
  type MemberOption,
} from "../_components/project-form"

export const dynamic = "force-dynamic"

export default async function NewProjectPage({
  searchParams,
}: {
  searchParams: Promise<{
    dealId?: string
    clientId?: string
    name?: string
    budget?: string
    status?: string
  }>
}) {
  const ctx = await requireOrgContext()
  const { dealId, clientId, name, budget, status } = await searchParams
  const supabase = await createClient()

  const { data: clientsData } = await supabase
    .from("clients")
    .select("id, name")
    .eq("org_id", ctx.orgId)
    .order("name", { ascending: true })
  const clients = (clientsData ?? []) as ClientOption[]
  const { data: people } = await supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId })
  const members: MemberOption[] = (people ?? []).map((p) => ({ id: p.user_id, name: p.full_name || "Team member" }))

  // Prefill from the board's quick create ("Edit"), or from a deal when arriving from CRM.
  const boardStatus = Constants.public.Enums.project_status.find((s) => s === status)
  let prefill: Partial<ProjectFormValues> = {
    ...(name ? { name } : {}),
    ...(budget ? { budgetBaht: budget } : {}),
    ...(boardStatus ? { status: boardStatus } : {}),
  }
  let resolvedDealId: string | null = null

  if (dealId) {
    const { data: deal } = await supabase
      .from("deals")
      .select("id, title, client_id, value_satang")
      .eq("org_id", ctx.orgId)
      .eq("id", dealId)
      .maybeSingle()
    if (deal) {
      resolvedDealId = deal.id
      prefill = {
        name: deal.title,
        clientId: deal.client_id ?? "none",
        budgetBaht: serviceAmountBaht(deal.value_satang ?? 0),
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
            members={members}
            defaultValues={prefill}
          />
        </CardContent>
      </Card>
    </div>
  )
}
