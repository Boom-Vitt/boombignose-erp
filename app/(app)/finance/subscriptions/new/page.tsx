import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { createSubscription } from "../../subscription-actions"
import {
  SubscriptionForm,
  type SubscriptionFormValues,
} from "../../_components/subscription-form"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

export default async function NewSubscriptionPage() {
  await requireOrgContext()
  const supabase = await createClient()

  const [clientsRes, projectsRes] = await Promise.all([
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
  ])

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: SubscriptionFormValues = {
    name: "",
    client_id: "",
    project_id: "",
    amountBaht: 0,
    interval: "monthly",
    start_date: todayISO(),
    notes: "",
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New subscription"
        description="Bill a client automatically on a recurring schedule."
      >
        <Button variant="outline" render={<Link href="/finance/subscriptions" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardContent>
          <SubscriptionForm
            clients={clients}
            projects={projects}
            defaultValues={defaultValues}
            submitLabel="Create subscription"
            action={createSubscription}
          />
        </CardContent>
      </Card>
    </div>
  )
}
