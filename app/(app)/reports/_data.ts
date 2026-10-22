import { readAll, readAllOrThrow } from "@/lib/supabase/read-all"
import { createClient } from "@/lib/supabase/server"
import { sumSatang } from "@/lib/money"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, lastNMonths, monthKey, todayISO } from "@/lib/dates"
import {
  revenueByClientMonth,
  hoursByProject,
  totalRevenueSatang,
  type ClientPayment,
  type ProjectTimeEntry,
  type Pivot,
} from "@/lib/metrics/reports"

const RANGE_MONTHS = 6
const NO_CLIENT = "Unassigned"
const NO_PROJECT = "No project"

export type ReportAggregates = {
  orgName: string
  /** Fixed column axis for the revenue pivot (oldest → newest). */
  months: string[]
  rangeLabel: string
  generatedAt: string
  revenue: Pivot
  hours: ReturnType<typeof hoursByProject>
  totalRevenueSatang: number
  cogsByMonth: { month: string; amount_satang: number }[]
  totalCogsSatang: number
}

/**
 * Org-scoped fetch + pure aggregation. Issued invoice bases join to
 * clients for names; time entries join to projects for names. Only
 * rows falling inside the last {@link RANGE_MONTHS} months (by app-timezone
 * month key) are counted. Money stays in integer satang.
 */
export async function getReportData(): Promise<ReportAggregates> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const months = lastNMonths(RANGE_MONTHS, currentMonthKey())
  const startDate = `${months[0]}-01`

  const [invoicesRes, entriesRes, cogs] = await Promise.all([
    readAll((from, to) => supabase
      .from("invoices")
      .select("status, total_satang, vat_satang, issue_date, clients(name)")
      .eq("org_id", ctx.orgId)
      .not("status", "in", "(draft,cancelled)")
      .gte("issue_date", startDate).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("time_entries")
      .select("minutes, billable, work_date, projects(name)")
      .eq("org_id", ctx.orgId)
      .gte("work_date", startDate).order("id").range(from, to)),
    readAllOrThrow((from, to) => supabase.from("monthly_inventory_cogs")
      .select("month,amount_satang").eq("org_id", ctx.orgId).gte("month", startDate)
      .order("month").range(from, to)),
  ])

  if (invoicesRes.error || entriesRes.error) throw new Error("Operational reports unavailable. Reload before relying on totals.")
  const inRange = new Set(months)

  const payments: ClientPayment[] = (invoicesRes.data ?? [])
    .filter((p) => p.status !== "draft" && p.status !== "cancelled" && inRange.has(monthKey(p.issue_date)))
    .map((p) => ({
      client_name: p.clients?.name ?? NO_CLIENT,
      amount_satang: p.total_satang - p.vat_satang,
      paid_at: p.issue_date,
    }))

  const entries: ProjectTimeEntry[] = (entriesRes.data ?? [])
    .filter((e) => inRange.has(monthKey(e.work_date)))
    .map((e) => ({
      project_name: e.projects?.name ?? NO_PROJECT,
      minutes: e.minutes,
      billable: e.billable,
    }))

  const revenue = revenueByClientMonth(payments, (paidAt) => monthKey(paidAt))
  const hours = hoursByProject(entries)
  const cogsByMonth = months.map((month) => ({
    month,
    amount_satang: sumSatang(cogs.filter((row) => row.month.slice(0, 7) === month).map((row) => row.amount_satang)),
  }))

  return {
    orgName: ctx.orgName,
    months,
    rangeLabel: `${months[0]} – ${months[months.length - 1]}`,
    generatedAt: `Generated ${todayISO()}`,
    revenue,
    hours,
    totalRevenueSatang: totalRevenueSatang(payments),
    cogsByMonth,
    totalCogsSatang: sumSatang(cogsByMonth.map((row) => row.amount_satang)),
  }
}
