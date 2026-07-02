import Link from "next/link"
import { notFound } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, satangToBaht } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

import { PageHeader } from "@/components/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"

import { updateSubscription } from "../../subscription-actions"
import {
  SubscriptionForm,
  type SubscriptionFormValues,
  type SubscriptionFormSubmitValues,
} from "../../_components/subscription-form"
import { SubscriptionControls } from "../../_components/subscription-controls"
import { SubscriptionStatusBadge } from "../../_components/subscription-status-badge"
import type { Option } from "../../_components/form-fields"

export const dynamic = "force-dynamic"

const INTERVAL_LABEL: Record<Enums<"recurring_interval">, string> = {
  weekly: "Weekly",
  monthly: "Monthly",
  quarterly: "Quarterly",
  yearly: "Yearly",
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </div>
  )
}

export default async function SubscriptionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const [subRes, clientsRes, projectsRes] = await Promise.all([
    supabase
      .from("subscriptions")
      .select(
        "id, name, amount_satang, interval, status, start_date, next_run_date, last_generated_on, auto_generate, notes, client_id, project_id, clients(name), projects(name)"
      )
      .eq("id", id)
      .maybeSingle(),
    supabase.from("clients").select("id, name").order("name"),
    supabase.from("projects").select("id, name").order("name"),
  ])

  const sub = subRes.data
  if (!sub) notFound()

  const canManage = ctx.role === "owner" || ctx.role === "admin"

  const clients: Option[] = (clientsRes.data ?? []).map((c) => ({
    value: c.id,
    label: c.name,
  }))
  const projects: Option[] = (projectsRes.data ?? []).map((p) => ({
    value: p.id,
    label: p.name,
  }))

  const defaultValues: SubscriptionFormValues = {
    name: sub.name,
    client_id: sub.client_id,
    project_id: sub.project_id ?? "",
    amountBaht: satangToBaht(sub.amount_satang),
    interval: sub.interval,
    start_date: sub.start_date,
    notes: sub.notes ?? "",
  }

  // Bind the subscription id into a real server action so the "use client"
  // SubscriptionForm can call it across the RSC boundary (like invoices/[id]).
  const subId = sub.id
  async function saveSubscription(values: SubscriptionFormSubmitValues) {
    "use server"
    return updateSubscription({ id: subId, ...values })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={sub.name}
        description={sub.clients?.name ?? "Subscription"}
      >
        <Button variant="outline" render={<Link href="/finance/subscriptions" />}>
          <ArrowLeft /> Back
        </Button>
      </PageHeader>

      <Card>
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">Overview</CardTitle>
          <SubscriptionStatusBadge status={sub.status} />
        </CardHeader>
        <CardContent className="space-y-4">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            <Field label="Amount" value={formatTHB(sub.amount_satang)} />
            <Field label="Interval" value={INTERVAL_LABEL[sub.interval]} />
            <Field label="Client" value={sub.clients?.name ?? "—"} />
            <Field label="Project" value={sub.projects?.name ?? "—"} />
            <Field label="Start date" value={sub.start_date} />
            <Field label="Next run" value={sub.next_run_date} />
            <Field
              label="Last generated"
              value={sub.last_generated_on ?? "—"}
            />
            <Field
              label="Auto-generate"
              value={sub.auto_generate ? "On" : "Off"}
            />
          </dl>
          {sub.notes ? (
            <>
              <Separator />
              <Field label="Notes" value={sub.notes} />
            </>
          ) : null}
          <Separator />
          <SubscriptionControls
            id={sub.id}
            status={sub.status}
            canManage={canManage}
          />
        </CardContent>
      </Card>

      <Card className="max-w-3xl">
        <CardHeader>
          <CardTitle className="text-base">Edit subscription</CardTitle>
        </CardHeader>
        <CardContent>
          <SubscriptionForm
            clients={clients}
            projects={projects}
            defaultValues={defaultValues}
            submitLabel="Save changes"
            action={saveSubscription}
          />
        </CardContent>
      </Card>
    </div>
  )
}
