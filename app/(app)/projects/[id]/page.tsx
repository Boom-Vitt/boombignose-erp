import { RecordHistory } from "@/components/record/record-history"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  FileSignature,
  Pencil,
  ReceiptText,
  ListChecks,
  Flag,
  Wallet,
  CalendarClock,
  User,
  Building2,
  Clock,
} from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { readAllOrThrow } from "@/lib/supabase/read-all"
import { requireOrgContext } from "@/lib/auth"
import { formatTHB, formatTHBWhole } from "@/lib/money"
import { projectProfit } from "@/lib/metrics/projects"
import { minutesToHours, billableValueSatang } from "@/lib/metrics/timesheets"
import { todayISO } from "@/lib/dates"
import { PROJECT_FLOW } from "@/lib/record/status"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import {
  ProjectStatusBadge,
  TaskStatusBadge,
  InvoiceStatusBadge,
  QuoteStatusBadge,
} from "@/components/status-badge"
import { StatusBar } from "@/components/record/status-bar"
import { SmartButtons, recordHref } from "@/components/record/smart-buttons"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { cn } from "@/lib/utils"
import type { Enums } from "@/lib/types/database"
import { deadlineMeta, formatDate } from "../_lib/dates"
import { profileNames } from "../_lib/profile-names"
import { StatusSelect } from "../_components/status-select"
import { TaskToggle, MilestoneToggle } from "../_components/toggle-check"
import { AddTaskForm } from "../_components/add-task-form"
import { AddMilestoneForm } from "../_components/add-milestone-form"
import { updateProjectStatus } from "../actions"
import { LogTimeForm } from "@/app/(app)/timesheets/_components/log-time-form"

export const dynamic = "force-dynamic"

function Field({
  icon: Icon,
  label,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="bg-muted text-muted-foreground mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md">
        <Icon className="size-4" />
      </div>
      <div className="min-w-0">
        <div className="text-muted-foreground text-xs font-medium">{label}</div>
        <div className="text-sm font-medium">{children}</div>
      </div>
    </div>
  )
}

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const ctx = await requireOrgContext()
  const { id } = await params
  const supabase = await createClient()

  const { data: project } = await supabase
    .from("projects")
    .select(
      "id, name, status, deadline, budget_satang, owner, client_id, client:clients(name)"
    ).eq("org_id", ctx.orgId)
    .eq("id", id)
    .maybeSingle()

  if (!project) notFound()

  const p = project as typeof project & {
    status: Enums<"project_status">
    client: { name: string } | null
  }

  const [
    { data: tasksData, count: taskCount },
    { count: doneTaskCount },
    { data: milestonesData },
    invoicesData,
    costsData,
    { data: timeData },
    { data: timeTotal },
    { data: sourceQuotes, count: quoteCount },
  ] = await Promise.all([
    supabase
      .from("project_tasks")
      .select("id, title, status, assignee, due_date, done", { count: "exact" })
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .order("done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    supabase
      .from("project_tasks")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .eq("done", true),
    supabase
      .from("milestones")
      .select("id, title, due_date, done, source_quote_id")
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .order("done", { ascending: true })
      .order("due_date", { ascending: true, nullsFirst: false })
      .order("created_at", { ascending: true }),
    readAllOrThrow((from, to) => supabase
      .from("invoices")
      .select("id, number, status, amount_satang, total_satang, vat_satang, source_quote_id, source_milestone_id")
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .order("id")
      .range(from, to)),
    readAllOrThrow((from, to) => supabase.from("costs").select("id, amount_satang").eq("org_id", ctx.orgId).eq("project_id", id).order("id").range(from, to)),
    supabase
      .from("time_entries")
      .select("project_id, minutes, billable, rate_satang")
      .eq("org_id", ctx.orgId)
      .eq("project_id", id),
    supabase
      .from("project_time_totals")
      .select("minutes")
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .maybeSingle(),
    supabase
      .from("quotes")
      .select("id, number, status, total_satang, converted_invoice_id", { count: "exact" })
      .eq("org_id", ctx.orgId)
      .eq("project_id", id)
      .order("created_at", { ascending: true }),
  ])

  const tasks = (tasksData ?? []) as Array<{
    id: string
    title: string
    status: Enums<"task_status">
    assignee: string | null
    due_date: string | null
    done: boolean
  }>
  const milestones = (milestonesData ?? []) as Array<{
    id: string
    title: string
    due_date: string | null
    done: boolean
    source_quote_id: string | null
  }>
  const invoices = invoicesData as Array<{
    id: string
    number: string
    status: Enums<"invoice_status">
    amount_satang: number
    total_satang: number
    vat_satang: number
    source_quote_id: string | null
    source_milestone_id: string | null
  }>
  const costs = costsData as Array<{ amount_satang: number }>
  const names = await profileNames(supabase, [
    p.owner,
    ...tasks.map((t) => t.assignee),
  ])
  const timeEntries = (timeData ?? []) as Array<{
    project_id: string
    minutes: number
    billable: boolean
    rate_satang: number | null
  }>

  const loggedMinutes = timeTotal?.minutes ?? 0
  const loggedBillable = billableValueSatang(timeEntries)

  const dl = deadlineMeta(p.deadline)
  const doneTasks = doneTaskCount ?? 0
  const totalTasks = taskCount ?? 0
  const doneMilestones = milestones.filter((m) => m.done).length

  const billedInvoices = invoices.filter((invoice) => ["sent", "partially_paid", "paid", "overdue"].includes(invoice.status))
  const hasFinancials = billedInvoices.length > 0 || costs.length > 0
  const profit = hasFinancials ? projectProfit(billedInvoices, costs) : null

  const projectId = p.id
  async function transitionProject(to: Enums<"project_status">) {
    "use server"
    return updateProjectStatus({ id: projectId, status: to })
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={p.name}
        description={p.client?.name ?? "No client"}
        breadcrumbs={[{ label: "Projects", href: "/projects" }]}
      >
        <Button variant="outline" render={<Link href={`/projects/${id}/edit`} />}>
          <Pencil data-icon="inline-start" /> Edit
        </Button>
      </PageHeader>

      <SmartButtons
        buttons={[
          {
            label: "Tasks",
            icon: ListChecks,
            count: totalTasks,
            value: `${doneTasks}/${totalTasks}`,
            href: "#tasks",
          },
          {
            label: "Hours logged",
            icon: Clock,
            count: loggedMinutes,
            value: minutesToHours(loggedMinutes).toFixed(1),
            href: "#time",
          },
          {
            label: "Invoices",
            icon: ReceiptText,
            count: invoices.length,
            href: invoices.length
              ? recordHref({ count: invoices.length, data: invoices }, (invoiceId) => `/finance/invoices/${invoiceId}`, "#billing")
              : "/finance/invoices/new",
            nextStep: p.status === "delivered" || p.status === "support",
          },
          {
            label: "Quotes",
            icon: FileSignature,
            count: quoteCount ?? 0,
            href: recordHref({ count: quoteCount, data: sourceQuotes }, (quoteId) => `/quotes/${quoteId}`, "#billing"),
          },
        ]}
      />
      <StatusBar
        label="Project status"
        flow={PROJECT_FLOW}
        status={p.status}
        transition={transitionProject}
      />

      {/* Overview + quick status change */}
      <Card>
        <CardContent className="space-y-5 pt-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <ProjectStatusBadge status={p.status} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground text-sm">Change status</span>
              <StatusSelect projectId={p.id} status={p.status} />
            </div>
          </div>
          <Separator />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field icon={Building2} label="Client">
              {p.client?.name ?? "—"}
            </Field>
            <Field icon={CalendarClock} label="Deadline">
              {dl ? (
                <span
                  className={cn(
                    dl.tone === "danger" && "text-red-600 dark:text-red-400",
                    dl.tone === "warning" && "text-amber-600 dark:text-amber-400"
                  )}
                >
                  {dl.label}
                  {dl.note ? (
                    <span className="block text-xs font-normal">{dl.note}</span>
                  ) : null}
                </span>
              ) : (
                "—"
              )}
            </Field>
            <Field icon={Wallet} label="Budget">
              {p.budget_satang != null ? formatTHBWhole(p.budget_satang) : "—"}
            </Field>
            <Field icon={User} label="Owner">
              {(p.owner && names.get(p.owner)) || "—"}
            </Field>
          </div>
        </CardContent>
      </Card>

      {sourceQuotes?.length || invoices.length ? (
        <Card id="billing">
          <CardHeader><CardTitle className="text-base">Quotes and invoices</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <ul className="space-y-2">
              {(sourceQuotes ?? []).map((quote) => (
                <li key={quote.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/quotes/${quote.id}`} className="font-medium hover:underline">{quote.number}</Link>
                  <QuoteStatusBadge status={quote.status} />
                  <span>{formatTHB(quote.total_satang)}</span>
                  {quote.converted_invoice_id ? <Link href={`/finance/invoices/${quote.converted_invoice_id}`} className="hover:underline">View draft or issued invoice</Link> : null}
                </li>
              ))}
            </ul>
            <ul className="space-y-2">
              {invoices.map((invoice) => (
                <li key={invoice.id} className="flex flex-wrap items-center gap-2 text-sm">
                  <Link href={`/finance/invoices/${invoice.id}`} className="font-medium hover:underline">{invoice.number}</Link>
                  <InvoiceStatusBadge status={invoice.status} />
                  <span>{formatTHB(invoice.amount_satang)}</span>
                  {invoice.source_quote_id ? <Link href={`/quotes/${invoice.source_quote_id}`} className="hover:underline">Source quote</Link> : null}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {/* Profit (only when there are invoices or costs) */}
      {profit ? (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard label="Revenue" value={formatTHB(profit.revenueSatang)} tone="positive" />
          <StatCard label="Cost" value={formatTHB(profit.costSatang)} tone="negative" />
          <StatCard
            label="Profit"
            value={formatTHB(profit.profitSatang)}
            tone={profit.profitSatang >= 0 ? "positive" : "negative"}
          />
          <StatCard
            label="Margin"
            value={`${profit.marginPct.toFixed(0)}%`}
            tone={profit.marginPct >= 0 ? "default" : "negative"}
            hint="Billed revenue vs. recorded cost"
          />
        </div>
      ) : null}

      {/* Tasks */}
      <Card id="tasks">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ListChecks className="size-4" /> Tasks
            <span className="text-muted-foreground text-sm font-normal">
              {doneTasks}/{totalTasks} done
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddTaskForm projectId={p.id} />
          {tasks.length === 0 ? (
            <EmptyState
              icon={ListChecks}
              title="No tasks yet"
              description="Break the project into tasks to track progress."
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {tasks.map((t) => (
                <li key={t.id} className="flex items-center gap-3 px-3 py-2.5">
                  <TaskToggle
                    id={t.id}
                    projectId={p.id}
                    done={t.done}
                    label={`Mark "${t.title}" done`}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      t.done && "text-muted-foreground line-through"
                    )}
                  >
                    {t.title}
                  </span>
                  {t.assignee && names.get(t.assignee) ? (
                    <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                      {names.get(t.assignee)}
                    </span>
                  ) : null}
                  {t.due_date ? (
                    <span className="text-muted-foreground hidden shrink-0 text-xs sm:inline">
                      {formatDate(t.due_date)}
                    </span>
                  ) : null}
                  <TaskStatusBadge status={t.status} />
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Milestones */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Flag className="size-4" /> Milestones
            <span className="text-muted-foreground text-sm font-normal">
              {doneMilestones}/{milestones.length} done
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <AddMilestoneForm projectId={p.id} />
          {milestones.length === 0 ? (
            <EmptyState
              icon={Flag}
              title="No milestones yet"
              description="Add checkpoints to mark key deliverables."
              className="border-0 p-6"
            />
          ) : (
            <ul className="divide-y rounded-md border">
              {milestones.map((m) => (
                <li id={`milestone-${m.id}`} key={m.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                  <MilestoneToggle
                    id={m.id}
                    projectId={p.id}
                    done={m.done}
                    label={`Mark "${m.title}" done`}
                  />
                  <span
                    className={cn(
                      "min-w-0 flex-1 truncate text-sm",
                      m.done && "text-muted-foreground line-through"
                    )}
                  >
                    {m.title}
                  </span>
                  {m.source_quote_id ? (
                    <Link href={`/quotes/${m.source_quote_id}`} className="text-xs hover:underline">Source quote</Link>
                  ) : null}
                  {invoices.filter((invoice) => invoice.source_milestone_id === m.id).map((invoice) => (
                    <Link key={invoice.id} href={`/finance/invoices/${invoice.id}`} className="text-xs hover:underline">{invoice.number}</Link>
                  ))}
                  {m.due_date ? (
                    <span className="text-muted-foreground shrink-0 text-xs">
                      {formatDate(m.due_date)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Time logged */}
      <Card id="time">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4" /> Time logged
            <span className="text-muted-foreground text-sm font-normal">
              {minutesToHours(loggedMinutes).toFixed(1)}h
              {loggedBillable > 0
                ? ` · ${formatTHB(loggedBillable)} billable`
                : ""}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Hours logged"
              value={`${minutesToHours(loggedMinutes).toFixed(1)}h`}
            />
            <StatCard
              label="Billable value"
              value={formatTHB(loggedBillable)}
              tone="positive"
            />
          </div>
          <LogTimeForm
            projects={[{ value: p.id, label: p.name }]}
            defaultProjectId={p.id}
            defaultWorkDate={todayISO()}
            lockProject
          />
        </CardContent>
      </Card>
      <RecordHistory recordType="project" recordId={id} />
    </div>
  )
}
