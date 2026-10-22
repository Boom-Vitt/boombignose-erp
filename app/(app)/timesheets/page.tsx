import Link from "next/link"
import { readAll } from "@/lib/supabase/read-all"
import { can } from "@/lib/permissions"
import { SearchFacets } from "@/components/search/search-facets"
import { GroupedTableRows } from "@/components/search/grouped-table-rows"
import { parseFacets, matchesFacets, type SearchParams } from "@/lib/search-facets"
import { getFacetSavedViews } from "@/lib/queries/saved-views"
import { Clock, Timer, Coins, Gauge } from "lucide-react"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, monthKey, todayISO } from "@/lib/dates"
import { formatTHB } from "@/lib/money"
import {
  totalMinutes,
  minutesToHours,
  billableValueSatang,
  utilization,
  entryValueSatang,
  canEditTimeEntry,
} from "@/lib/metrics/timesheets"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

import type { Option } from "./_components/form-fields"
import { LogTimeForm } from "./_components/log-time-form"
import { BillTimeForm, MemberCostRateForm } from "./_components/billing-controls"
import { EditTimeEntryButton } from "./_components/edit-time-entry-button"
import { DeleteTimeEntryButton } from "./_components/delete-time-entry-button"

export const dynamic = "force-dynamic"

const dateFmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

function formatDate(iso: string): string {
  return dateFmt.format(new Date(`${iso}T00:00:00`))
}

type EntryRow = {
  id: string
  work_date: string
  minutes: number
  billable: boolean
  rate_satang: number | null
  project_id: string
  user_id: string | null
  notes: string | null
  invoice_id: string | null
  invoices: { status: string; number: string } | null
  projects: { name: string } | null
}

export default async function TimesheetsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await requireOrgContext()
  const config = parseFacets(await searchParams, "timesheets")
  const now = new Date()
  const savedViews = await getFacetSavedViews("timesheets")
  const supabase = await createClient()
  const month = currentMonthKey()
  const today = todayISO()
  const staff = can(ctx.role, "settings:manage")

  const [entriesRes, projectsRes, membersRes, ratesRes] = await Promise.all([
    readAll((from, to) => supabase
      .from("time_entries")
      .select("id, work_date, minutes, billable, rate_satang, project_id, user_id, notes, invoice_id, invoices(status, number), projects(name)")
      .eq("org_id", ctx.orgId)
      .order("work_date", { ascending: false }).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("projects").select("id, name").eq("org_id", ctx.orgId).order("name").order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("memberships").select("user_id").eq("org_id", ctx.orgId).order("id").range(from, to)),
    staff ? readAll((from, to) => supabase
      .from("member_cost_rates").select("user_id,cost_rate_satang").eq("org_id", ctx.orgId).order("user_id").range(from, to))
      : { data: [], error: null },
  ])

  if (entriesRes.error || projectsRes.error || membersRes.error || ratesRes.error) throw new Error("Timesheets unavailable. Please reload.")
  const allEntries = (entriesRes.data ?? []) as EntryRow[]
  const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string }>

  const projectOptions: Option[] = projects.map((p) => ({
    value: p.id,
    label: p.name,
  }))

  // Resolve who logged each entry. `time_entries.user_id` references auth.users
  // (no PostgREST FK to profiles), so fetch the profiles separately and map.
  const nameById = new Map<string, string>()
  const { data: profiles, error: profilesError } = await readAll((from, to) => supabase
    .from("profiles").select("id, full_name").order("id").range(from, to))
  if (profilesError) throw new Error("Time-entry users unavailable. Please reload.")
  for (const profile of profiles ?? []) if (profile.full_name) nameById.set(profile.id, profile.full_name)
  const rateById = new Map((ratesRes.data ?? []).map(rate => [rate.user_id, rate.cost_rate_satang]))
  const members = (membersRes.data ?? []).map(member => ({ value: member.user_id, label: nameById.get(member.user_id) ?? "Member", rate: rateById.get(member.user_id) ?? 0 }))

  const entries = allEntries.filter((e) => matchesFacets(config, {
    text: `${e.projects?.name ?? ""} ${e.user_id ? nameById.get(e.user_id) ?? "" : ""}`,
    status: e.billable ? "billable" : "non_billable", date: e.work_date, owner: e.user_id,
  }, ctx.userId, now))

  // This-month metrics.
  const monthEntries = allEntries.filter((e) => monthKey(e.work_date) === month)
  const monthMinutes = totalMinutes(monthEntries)
  const monthBillable = billableValueSatang(monthEntries)
  const monthUtil = utilization(monthEntries)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Timesheets"
        description="Log billable hours and track utilization across projects."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Hours this month"
          value={`${minutesToHours(monthMinutes).toFixed(1)}h`}
          icon={Timer}
          hint="Time logged this month"
        />
        <StatCard
          label="Billable value"
          value={formatTHB(monthBillable)}
          icon={Coins}
          tone="positive"
          hint="This month, billable hours × rate"
        />
        <StatCard
          label="Utilization"
          value={`${Math.round(monthUtil * 100)}%`}
          icon={Gauge}
          hint="Billable ÷ total minutes this month"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Clock className="size-4" /> Log time
          </CardTitle>
        </CardHeader>
        <CardContent>
          {projectOptions.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="No projects yet"
              description="Create a project before logging time against it."
              className="border-0"
            />
          ) : (
            <LogTimeForm projects={projectOptions} defaultWorkDate={today} />
          )}
        </CardContent>
      </Card>

      {staff ? <Card>
        <CardHeader><CardTitle className="text-base">Billing and labour cost</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <BillTimeForm projects={projectOptions} />
          <MemberCostRateForm members={members} />
        </CardContent>
      </Card> : null}

      <SearchFacets list="timesheets" config={config} savedViews={savedViews} />

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState
              icon={Timer}
              title={Object.keys(config).length ? "No matching time entries" : "No time logged yet"}
              description={Object.keys(config).length ? "No entries match the selected filters." : "Log your first hours to start tracking utilization."}
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Who</TableHead>
                  <TableHead className="text-right">Hours</TableHead>
                  <TableHead>Billable</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                <GroupedTableRows rows={entries} colSpan={8} amount={entryValueSatang}
                group={config.groupBy ? (e) => config.groupBy === "project"
                  ? { key: e.project_id, label: e.projects?.name ?? "No project" }
                  : { key: monthKey(e.work_date), label: monthKey(e.work_date) } : undefined}>
                {(e) => {
                  const value = entryValueSatang(e)
                  return (
                    <TableRow key={e.id}>
                      <TableCell className="text-muted-foreground">
                        {formatDate(e.work_date)}
                      </TableCell>
                      <TableCell className="font-medium">
                        {e.projects?.name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {(e.user_id && nameById.get(e.user_id)) || "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {minutesToHours(e.minutes).toFixed(2)}
                      </TableCell>
                      <TableCell>
                        {e.billable ? (
                          <Badge variant="secondary">Billable</Badge>
                        ) : (
                          <Badge variant="outline">Non-billable</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {value > 0 ? formatTHB(value) : "—"}
                      </TableCell>
                      <TableCell>{e.invoice_id ? <Link className="text-sm underline" href={`/finance/invoices/${e.invoice_id}`}>{e.invoices?.number ?? "Invoice"}{e.invoices?.status === "cancelled" ? " (cancelled)" : ""}</Link> : "Unbilled"}</TableCell>
                      <TableCell className="text-right">
                        {canEditTimeEntry(ctx.userId, ctx.role, { ...e, invoice_status: e.invoices?.status ?? null }) ? <div className="flex justify-end">
                        <EditTimeEntryButton entry={e} />
                        <DeleteTimeEntryButton
                          id={e.id}
                          label={`${minutesToHours(e.minutes).toFixed(2)}h on ${
                            e.projects?.name ?? "project"
                          }`}
                        />
                        </div> : <span className="text-muted-foreground text-xs">Locked</span>}
                      </TableCell>
                    </TableRow>
                  )
                }}</GroupedTableRows>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
