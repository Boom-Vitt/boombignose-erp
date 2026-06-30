import {
  Wallet,
  TrendingUp,
  Flame,
  Hourglass,
  Target,
  Repeat,
  FileWarning,
  Briefcase,
  CalendarClock,
  AlertTriangle,
} from "lucide-react"

import { getDashboardData } from "@/lib/queries/dashboard"
import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { formatTHB, formatTHBWhole } from "@/lib/money"

export const dynamic = "force-dynamic"

function runwayLabel(months: number | null): { value: string; hint: string; tone: "default" | "positive" | "warning" | "negative" } {
  if (months === null) return { value: "∞", hint: "Revenue ≥ burn this month", tone: "positive" }
  const rounded = months.toFixed(1)
  if (months < 6) return { value: `${rounded} mo`, hint: "Runway under 6 months", tone: "negative" }
  if (months < 12) return { value: `${rounded} mo`, hint: "Keep an eye on burn", tone: "warning" }
  return { value: `${rounded} mo`, hint: "Healthy runway", tone: "default" }
}

export default async function DashboardPage() {
  const d = await getDashboardData()
  const runway = runwayLabel(d.runwayMonths)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description="Cash, pipeline, delivery, and what needs attention today."
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Cash on hand"
          value={formatTHBWhole(d.cashSatang)}
          icon={Wallet}
          hint="Manual balance · edit in Settings"
        />
        <StatCard
          label="Revenue this month"
          value={formatTHB(d.monthlyRevenueSatang)}
          icon={TrendingUp}
          tone="positive"
        />
        <StatCard
          label="Burn this month"
          value={formatTHB(d.monthlyBurnSatang)}
          icon={Flame}
          tone="negative"
          hint={`Net burn ${formatTHB(d.netBurnSatang)}`}
        />
        <StatCard
          label="Runway"
          value={runway.value}
          icon={Hourglass}
          tone={runway.tone}
          hint={runway.hint}
        />
        <StatCard
          label="Open pipeline"
          value={formatTHBWhole(d.pipelineSatang)}
          icon={Target}
          hint={`Weighted ${formatTHBWhole(d.weightedPipelineSatang)}`}
        />
        <StatCard
          label="MRR"
          value={formatTHB(d.mrrSatang)}
          icon={Repeat}
          hint="Recurring revenue / month"
        />
        <StatCard
          label="Unpaid invoices"
          value={formatTHB(d.unpaidSatang)}
          icon={FileWarning}
          tone={d.overdueInvoiceCount > 0 ? "warning" : "default"}
          hint={`${d.unpaidInvoiceCount} open · ${d.overdueInvoiceCount} overdue`}
        />
        <StatCard
          label="Active projects"
          value={String(d.activeProjectCount)}
          icon={Briefcase}
          hint="In delivery or support"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <CalendarClock className="size-4" /> Follow-ups due today
            </CardTitle>
          </CardHeader>
          <CardContent>
            {d.followUpsDueToday.length === 0 ? (
              <EmptyState
                icon={CalendarClock}
                title="Nothing due today"
                description="You're all caught up on follow-ups."
                className="border-0 p-6"
              />
            ) : (
              <ul className="divide-y">
                {d.followUpsDueToday.map((f) => (
                  <li key={f.id} className="flex items-center gap-3 py-2.5 text-sm">
                    <Badge variant="outline" className="shrink-0 capitalize">
                      {f.type.replace("_", " ")}
                    </Badge>
                    <span className="truncate">{f.body ?? "Follow up"}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4" /> Needs attention
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between rounded-md border p-3 text-sm">
              <span>Overdue invoices</span>
              <Badge variant={d.overdueInvoiceCount > 0 ? "destructive" : "secondary"}>
                {d.overdueInvoiceCount}
              </Badge>
            </div>
            <div className="rounded-md border">
              <div className="border-b px-3 py-2 text-sm font-medium">
                Overdue follow-ups ({d.overdueFollowUps.length})
              </div>
              {d.overdueFollowUps.length === 0 ? (
                <p className="text-muted-foreground px-3 py-3 text-sm">None — nice work.</p>
              ) : (
                <ul className="divide-y">
                  {d.overdueFollowUps.slice(0, 5).map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                      <Badge variant="outline" className="shrink-0 capitalize">
                        {f.type.replace("_", " ")}
                      </Badge>
                      <span className="truncate">{f.body ?? "Follow up"}</span>
                      <span className="text-muted-foreground ml-auto shrink-0 text-xs">
                        {f.due_date}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
