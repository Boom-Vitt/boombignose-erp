import Link from "next/link"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { activeProductOptions } from "@/lib/products/queries"

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
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [clientsRes, projectsRes, settingsRes, products] = await Promise.all([
    supabase.from("clients").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("projects").select("id, name").eq("org_id", ctx.orgId).order("name"),
    supabase.from("org_settings").select("prices_include_vat").eq("org_id", ctx.orgId).maybeSingle(),
    activeProductOptions(),
  ])
  if (settingsRes.error) throw new Error(settingsRes.error.message)

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
    product_id: null,
    unit: "period",
    tax_rate_bps: undefined,
    wht_rate_bps: undefined,
    prices_include_vat: settingsRes.data?.prices_include_vat ?? false,
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
            products={products}
            defaultValues={defaultValues}
            submitLabel="Create subscription"
            action={createSubscription}
          />
        </CardContent>
      </Card>
    </div>
  )
}
