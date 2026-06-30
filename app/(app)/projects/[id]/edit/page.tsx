import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { satangToBaht } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { updateProject } from "../../actions"
import {
  ProjectForm,
  type ProjectFormValues,
  type ClientOption,
} from "../../_components/project-form"

export const dynamic = "force-dynamic"

export default async function EditProjectPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireOrgContext()
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select("id, name, client_id, status, deadline, budget_satang, owner")
    .eq("id", id)
    .maybeSingle()

  if (!project) notFound()

  const { data: clientsData } = await supabase
    .from("clients")
    .select("id, name")
    .order("name", { ascending: true })
  const clients = (clientsData ?? []) as ClientOption[]

  const defaultValues: Partial<ProjectFormValues> = {
    name: project.name,
    clientId: project.client_id ?? "none",
    status: project.status,
    deadline: project.deadline ?? "",
    budgetBaht:
      project.budget_satang != null ? satangToBaht(project.budget_satang) : 0,
    owner: project.owner ?? "",
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
            defaultValues={defaultValues}
            submitLabel="Save changes"
          />
        </CardContent>
      </Card>
    </div>
  )
}
