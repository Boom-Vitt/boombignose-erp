import Link from "next/link"
import { notFound } from "next/navigation"
import { Pencil, FolderPlus, ArrowLeft } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { PageHeader } from "@/components/page-header"
import { DealStageBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ChangeStageSelect } from "../_components/change-stage-select"
import { ActivitiesSection } from "../_components/activities-section"

export const dynamic = "force-dynamic"

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const supabase = await createClient()
  const today = todayISO()

  const { data: deal } = await supabase
    .from("deals")
    .select(
      "id,client_id,title,stage,value_satang,expected_close_date,next_follow_up_date,source,notes,created_at"
    )
    .eq("id", id)
    .maybeSingle()

  if (!deal) notFound()

  const [{ data: client }, { data: activities }] = await Promise.all([
    supabase.from("clients").select("id,name").eq("id", deal.client_id).maybeSingle(),
    supabase
      .from("activities")
      .select("id,type,body,due_date,done,created_at")
      .eq("deal_id", id)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false }),
  ])

  const followUp = deal.next_follow_up_date
  const followUpOverdue = followUp != null && followUp < today
  const followUpDueToday = followUp === today

  return (
    <div className="space-y-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="mb-2 -ml-2"
          render={<Link href="/deals" />}
        >
          <ArrowLeft className="size-4" />
          Pipeline
        </Button>
        <PageHeader title={deal.title} description={client?.name ?? undefined}>
          {deal.stage === "won" ? (
            <Button
              render={
                <Link
                  href={`/projects/new?dealId=${deal.id}&clientId=${deal.client_id}`}
                />
              }
            >
              <FolderPlus className="size-4" />
              Create project
            </Button>
          ) : null}
          <Button
            variant="outline"
            render={<Link href={`/deals/${deal.id}/edit`} />}
          >
            <Pencil className="size-4" />
            Edit
          </Button>
        </PageHeader>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-1">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Deal</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <Field label="Value">
                <span className="text-base font-semibold">
                  {formatTHB(deal.value_satang)}
                </span>
              </Field>
              <Field label="Stage">
                <DealStageBadge stage={deal.stage} />
              </Field>
              <Field label="Change stage">
                <ChangeStageSelect dealId={deal.id} stage={deal.stage} />
              </Field>
              <Field label="Expected close">
                {deal.expected_close_date ?? "—"}
              </Field>
              <Field label="Next follow-up">
                <span
                  className={cn(
                    followUpOverdue
                      ? "font-medium text-red-600 dark:text-red-400"
                      : followUpDueToday
                        ? "font-medium text-amber-600 dark:text-amber-400"
                        : undefined
                  )}
                >
                  {followUp
                    ? `${followUpOverdue ? "Overdue · " : followUpDueToday ? "Today · " : ""}${followUp}`
                    : "—"}
                </span>
              </Field>
              <Field label="Source">{deal.source ?? "—"}</Field>
              {deal.notes ? (
                <Field label="Notes">
                  <p className="whitespace-pre-wrap">{deal.notes}</p>
                </Field>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Activities</CardTitle>
            </CardHeader>
            <CardContent>
              <ActivitiesSection
                dealId={deal.id}
                activities={activities ?? []}
                today={today}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="space-y-1">
      <div className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
        {label}
      </div>
      <div>{children}</div>
    </div>
  )
}
