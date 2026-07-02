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
  projects: { name: string } | null
}

export default async function TimesheetsPage() {
  await requireOrgContext()
  const supabase = await createClient()
  const month = currentMonthKey()
  const today = todayISO()

  const [entriesRes, projectsRes] = await Promise.all([
    supabase
      .from("time_entries")
      .select(
        "id, work_date, minutes, billable, rate_satang, project_id, user_id, projects(name)"
      )
      .order("work_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(100),
    supabase
      .from("projects")
      .select("id, name")
      .order("name", { ascending: true }),
  ])

  const entries = (entriesRes.data ?? []) as EntryRow[]
  const projects = (projectsRes.data ?? []) as Array<{ id: string; name: string }>

  const projectOptions: Option[] = projects.map((p) => ({
    value: p.id,
    label: p.name,
  }))

  // Resolve who logged each entry. `time_entries.user_id` references auth.users
  // (no PostgREST FK to profiles), so fetch the profiles separately and map.
  const userIds = Array.from(
    new Set(entries.map((e) => e.user_id).filter((v): v is string => !!v))
  )
  const nameById = new Map<string, string>()
  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", userIds)
    for (const p of profiles ?? []) {
      if (p.full_name) nameById.set(p.id, p.full_name)
    }
  }

  // This-month metrics.
  const monthEntries = entries.filter((e) => monthKey(e.work_date) === month)
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

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent entries</CardTitle>
        </CardHeader>
        <CardContent>
          {entries.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No time logged yet"
              description="Log your first hours to start tracking utilization."
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
                  <TableHead className="w-10" aria-label="Actions" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
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
                      <TableCell className="text-right">
                        <DeleteTimeEntryButton
                          id={e.id}
                          label={`${minutesToHours(e.minutes).toFixed(2)}h on ${
                            e.projects?.name ?? "project"
                          }`}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
