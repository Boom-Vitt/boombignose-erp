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
import { dealOptions } from "@/app/(app)/deals/_lib/deal-options"

export const dynamic = "force-dynamic"

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ clientId?: string; dealId?: string }>
}) {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const q = await searchParams

  const [clientsRes, projectsRes, deals] = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name"),
    dealOptions(supabase, ctx.orgId, q.dealId),
  ])
  // Prefill from a deal's "Quotes" button; an id that isn't one of this org's deals is ignored.
  const prefillDeal = deals.find((d) => d.value === q.dealId)

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: QuoteFormValues = {
    client_id: prefillDeal?.clientId ?? "",
    project_id: "",
    deal_id: prefillDeal?.value ?? "",
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
            deals={deals}
            defaultValues={defaultValues}
            submitLabel="Create quote"
            action={createQuote}
          />
        </CardContent>
      </Card>
    </div>
  )
}
