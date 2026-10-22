import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FileSignature, FolderKanban, Pencil } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import { expectedRevenue } from "@/lib/metrics/pipeline"
import { can } from "@/lib/permissions"
import { DEAL_FLOW } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"
import { PageHeader } from "@/components/page-header"
import { DealStageBadge } from "@/components/status-badge"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"
import { ChangeStageSelect } from "../_components/change-stage-select"
import { MarkLostButton } from "../_components/lost-reason-dialog"
import { formatDate } from "@/app/(app)/clients/_lib/format"
import { ActivitiesSection } from "../_components/activities-section"
import { AiPanel } from "../_components/ai-panel"
import { updateDealStage } from "../actions"

export const dynamic = "force-dynamic"

export default async function DealDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()

  const { data: deal } = await supabase
    .from("deals")
    .select(
      "id,client_id,title,stage,value_satang,probability,won_at,lost_at,expected_close_date,next_follow_up_date,source,notes,created_at,lost_reason:deal_lost_reasons(name)"
    ).eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle()

  if (!deal) notFound()

  const [{ data: client }, { data: activities }, projectsRes, quotesRes, reasonsRes] = await Promise.all([
    supabase.from("clients").select("id,name").eq("org_id", ctx.orgId).eq("id", deal.client_id).maybeSingle(),
    supabase
      .from("activities")
      .select("id,type,body,due_date,done,created_at")
      .eq("org_id", ctx.orgId)
      .eq("deal_id", id)
      .order("done", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase.from("projects").select("id", { count: "exact" }).eq("org_id", ctx.orgId).eq("deal_id", id).limit(1),
    supabase.from("quotes").select("id", { count: "exact" }).eq("org_id", ctx.orgId).eq("deal_id", id).limit(1),
    supabase.from("deal_lost_reasons").select("id,name").eq("org_id", ctx.orgId).eq("active", true).order("name"),
  ])
  const lostReasons = reasonsRes.data ?? []
  const canManageReasons = can(ctx.role, "settings:manage")
  const projectCount = projectsRes.count ?? 0

  const dealId = deal.id
  async function transitionDeal(to: Enums<"deal_stage">) {
    "use server"
    return updateDealStage(dealId, to)
  }
  async function loseDeal(lostReasonId: string, note: string) {
    "use server"
    return updateDealStage(dealId, "lost", { lostReasonId, note })
  }

  const followUp = deal.next_follow_up_date
  const followUpOverdue = followUp != null && followUp < today
  const followUpDueToday = followUp === today

  return (
    <div className="space-y-6">
      <PageHeader
        title={deal.title}
        description={client?.name ?? undefined}
        breadcrumbs={[{ label: "Deals", href: "/deals" }]}
      >
        <Button
          variant="outline"
          render={<Link href={`/deals/${deal.id}/edit`} />}
        >
          <Pencil className="size-4" />
          Edit
        </Button>
      </PageHeader>

      <SmartButtons
        buttons={[
          {
            label: "Quotes",
            icon: FileSignature,
            count: quotesRes.count ?? 0,
            href: quotesRes.count
              ? recordHref(quotesRes, (quoteId) => `/quotes/${quoteId}`, "/quotes")
              : `/quotes/new?${new URLSearchParams({ clientId: deal.client_id, dealId: deal.id })}`,
            nextStep: deal.stage === "proposal" || deal.stage === "negotiation",
          },
          {
            label: "Projects",
            icon: FolderKanban,
            count: projectCount,
            href: recordHref(projectsRes, (projectId) => `/projects/${projectId}`, "/projects"),
          },
        ]}
      />
      <StatusBar
        label="Deal stage"
        flow={DEAL_FLOW}
        status={deal.stage}
        transition={transitionDeal}
        record={{ recordType: "deal", recordId: deal.id }}
        commands={{
          ...(projectCount ? {} : { create_project: `/projects/new?dealId=${deal.id}&clientId=${deal.client_id}` }),
          lose: ({ label, variant }) => (
            <MarkLostButton
              label={label}
              variant={variant}
              dealTitle={deal.title}
              reasons={lostReasons}
              canManage={canManageReasons}
              onConfirm={loseDeal}
            />
          ),
        }}
      />

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
              <Field label="Probability">
                {deal.probability}%
                <span className="text-muted-foreground"> · expected {formatTHB(expectedRevenue(deal))}</span>
              </Field>
              <Field label="Stage">
                <DealStageBadge stage={deal.stage} />
              </Field>
              {deal.won_at ? <Field label="Won on">{formatDate(deal.won_at)}</Field> : null}
              {deal.lost_at ? (
                <Field label="Lost">
                  {deal.lost_reason?.name ?? "No reason recorded"} · {formatDate(deal.lost_at)}
                </Field>
              ) : null}
              <Field label="Change stage">
                <ChangeStageSelect
                  dealId={deal.id}
                  dealTitle={deal.title}
                  stage={deal.stage}
                  lostReasons={lostReasons}
                  canManageReasons={canManageReasons}
                />
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

          <AiPanel dealId={deal.id} />
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
      <RecordHistory recordType="deal" recordId={id} />
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
