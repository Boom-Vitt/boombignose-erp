import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { serviceAmountBaht } from "@/lib/workflows/service"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { updateProject } from "../../actions"
import {
  ProjectForm,
  type ProjectFormValues,
  type ClientOption,
  type MemberOption,
} from "../../_components/project-form"

export const dynamic = "force-dynamic"

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrgContext()
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, client_id, status, deadline, budget_satang, owner")
    .eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle()

  if (!project) notFound()

  const { data: clientsData } = await supabase
    .from("clients")
    .select("id, name")
    .eq("org_id", ctx.orgId)
    .order("name", { ascending: true })
  const clients = (clientsData ?? []) as ClientOption[]
  const { data: people } = await supabase.rpc("record_activity_assignees", { p_org_id: ctx.orgId })
  const members: MemberOption[] = (people ?? []).map((p) => ({ id: p.user_id, name: p.full_name || "Team member" }))
  // Keep an owner who has left selectable, so saving other fields does not clear them.
  if (project.owner && !members.some((m) => m.id === project.owner)) {
    members.push({ id: project.owner, name: "Former member" })
  }

  const defaultValues: Partial<ProjectFormValues> = {
    name: project.name,
    clientId: project.client_id ?? "none",
    status: project.status,
    deadline: project.deadline ?? "",
    budgetBaht:
      project.budget_satang != null ? serviceAmountBaht(project.budget_satang) : 0,
    owner: project.owner ?? "none",
  }

  async function action(values: ProjectFormValues) {
    "use server"
    return updateProject({ ...values, id })
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Edit project" description={project.name}>
        <Button variant="outline" render={<Link href={`/projects/${id}`} />}>
          <ArrowLeft data-icon="inline-start" /> Back
        </Button>
      </PageHeader>

      <Card>
        <CardContent className="pt-6">
          <ProjectForm
            action={action}
            clients={clients}
            members={members}
            defaultValues={defaultValues}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  )
}
