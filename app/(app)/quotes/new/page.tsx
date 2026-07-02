import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"

import { createQuote } from "../actions"
import { QuoteForm, type QuoteFormValues } from "../_components/quote-form"
import type { Option } from "../_components/form-fields"

export const dynamic = "force-dynamic"

export default async function NewQuotePage() {
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

  const defaultValues: QuoteFormValues = {
    client_id: "",
    project_id: "",
    number: "",
    issue_date: todayISO(),
    valid_until: "",
    discountBaht: 0,
    notes: "",
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="New quote"
        description="Draft a proposal — add line items after creating it."
      >
        <Button variant="outline" render={<Link href="/quotes" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card className="max-w-3xl">
        <CardContent>
          <QuoteForm
            clients={clients}
            projects={projects}
            defaultValues={defaultValues}
            submitLabel="Create quote"
            action={createQuote}
          />
        </CardContent>
      </Card>
    </div>
  )
}
