import Link from "next/link"
import { TrendingUp, Timer, Printer, BarChart3, Clock } from "lucide-react"

import { formatTHB } from "@/lib/money"
import { getReportData } from "./_data"

import { PageHeader } from "@/components/page-header"
import { StatCard } from "@/components/stat-card"
import { EmptyState } from "@/components/empty-state"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table"

export const dynamic = "force-dynamic"

/** Hours with two decimals, e.g. 3.5 → "3.50". */
function fmtHours(hours: number): string {
  return hours.toFixed(2)
}

export default async function ReportsPage() {
  const { months, rangeLabel, revenue, hours, totalRevenueSatang } =
    await getReportData()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description={`Operational reports · ${rangeLabel}`}
      >
        <Button
          variant="outline"
          render={
            <Link href="/reports/print" target="_blank" rel="noopener" />
          }
        >
          <Printer /> Print / PDF
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatCard
          label="Total revenue"
          value={formatTHB(totalRevenueSatang)}
          icon={TrendingUp}
          tone="positive"
          hint="Payments received in range"
        />
        <StatCard
          label="Billable hours"
          value={fmtHours(hours.billableHours)}
          icon={Timer}
          hint="Logged & billable in range"
        />
        <StatCard
          label="Total hours"
          value={fmtHours(hours.totalHours)}
          icon={Clock}
          hint="All time logged in range"
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Revenue by client × month</CardTitle>
        </CardHeader>
        <CardContent>
          {revenue.rowKeys.length === 0 ? (
            <EmptyState
              icon={BarChart3}
              title="No payments in range"
              description="Recorded payments will pivot here by client and month."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  {months.map((m) => (
                    <TableHead key={m} className="text-right">
                      {m}
                    </TableHead>
                  ))}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {revenue.rowKeys.map((client) => (
                  <TableRow key={client}>
                    <TableCell className="font-medium">{client}</TableCell>
                    {months.map((m) => (
                      <TableCell
                        key={m}
                        className="text-right tabular-nums"
                      >
                        {formatTHB(revenue.cell(client, m))}
                      </TableCell>
                    ))}
                    <TableCell className="text-right font-semibold tabular-nums">
                      {formatTHB(revenue.rowTotal(client))}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  {months.map((m) => (
                    <TableCell
                      key={m}
                      className="text-right font-semibold tabular-nums"
                    >
                      {formatTHB(revenue.colTotal(m))}
                    </TableCell>
                  ))}
                  <TableCell className="text-right font-semibold tabular-nums">
                    {formatTHB(revenue.grandTotal)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Hours by project</CardTitle>
        </CardHeader>
        <CardContent>
          {hours.projects.length === 0 ? (
            <EmptyState
              icon={Timer}
              title="No time logged in range"
              description="Logged time entries will roll up here by project."
              className="border-0"
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Project</TableHead>
                  <TableHead className="text-right">Total hours</TableHead>
                  <TableHead className="text-right">Billable hours</TableHead>
                  <TableHead className="text-right">Non-billable</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hours.projects.map((p) => (
                  <TableRow key={p.project_name}>
                    <TableCell className="font-medium">
                      {p.project_name}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.totalHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.billableHours)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {fmtHours(p.totalHours - p.billableHours)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow className="border-t-2">
                  <TableCell className="font-semibold">Total</TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.totalHours)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.billableHours)}
                  </TableCell>
                  <TableCell className="text-right font-semibold tabular-nums">
                    {fmtHours(hours.totalHours - hours.billableHours)}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
