import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { createCost } from "../../actions"
import { CostForm } from "../../_components/cost-form"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

export default async function NewCostPage() {
  await requireOrgContext()
  const supabase = await createClient()

  const projectsRes = await supabase
    .from("projects")
    .select("id, name")
    .order("name")

  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="New cost"
        description="Log an operating cost — software, contractors, infra, and more."
      >
        <Button variant="outline" render={<Link href="/finance" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardContent>
          <CostForm
            projects={projects}
            today={todayISO()}
            action={createCost}
          />
        </CardContent>
      </Card>
    </div>
  )
}
