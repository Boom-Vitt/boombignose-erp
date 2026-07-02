import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, monthKey, todayISO } from "@/lib/dates"
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

/** The last `n` calendar month keys ('YYYY-MM'), oldest first, ending at `current`. */
export function lastNMonths(n: number, current: string): string[] {
  const [y, m] = current.split("-").map(Number)
  const out: string[] = []
  for (let i = n - 1; i >= 0; i--) {
    let mm = m - i
    let yy = y
    while (mm <= 0) {
      mm += 12
      yy -= 1
    }
    out.push(`${yy}-${String(mm).padStart(2, "0")}`)
  }
  return out
}

export type ReportAggregates = {
  orgName: string
  /** Fixed column axis for the revenue pivot (oldest → newest). */
  months: string[]
  rangeLabel: string
  generatedAt: string
  revenue: Pivot
  hours: ReturnType<typeof hoursByProject>
  totalRevenueSatang: number
}

/**
 * Org-scoped fetch + pure aggregation for the Reports module. Payments join to
 * invoices → clients for names; time entries join to projects for names. Only
 * rows falling inside the last {@link RANGE_MONTHS} months (by app-timezone
 * month key) are counted. Money stays in integer satang.
 */
export async function getReportData(): Promise<ReportAggregates> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()

  const months = lastNMonths(RANGE_MONTHS, currentMonthKey())
  const startDate = `${months[0]}-01`

  const [paymentsRes, entriesRes] = await Promise.all([
    supabase
      .from("payments")
      .select("amount_satang, paid_at, invoices(clients(name))")
      .eq("org_id", ctx.orgId)
      .gte("paid_at", startDate),
    supabase
      .from("time_entries")
      .select("minutes, billable, work_date, projects(name)")
      .eq("org_id", ctx.orgId)
      .gte("work_date", startDate),
  ])

  const inRange = new Set(months)

  const payments: ClientPayment[] = (paymentsRes.data ?? [])
    .filter((p) => inRange.has(monthKey(p.paid_at)))
    .map((p) => ({
      client_name: p.invoices?.clients?.name ?? NO_CLIENT,
      amount_satang: p.amount_satang,
      paid_at: p.paid_at,
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

  return {
    orgName: ctx.orgName,
    months,
    rangeLabel: `${months[0]} – ${months[months.length - 1]}`,
    generatedAt: `Generated ${todayISO()}`,
    revenue,
    hours,
    totalRevenueSatang: totalRevenueSatang(payments),
  }
}
