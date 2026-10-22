import { readAll } from "./read-all"
import { createClient } from "@/lib/supabase/server"
import { requireOrgContext } from "@/lib/auth"
import { currentMonthKey, lastNMonths, todayISO, isPastDue, startOfDayInstant } from "@/lib/dates"
import {
  revenueForMonth,
  costsForMonth,
  mrr,
  subscriptionMrr,
  unpaidTotal,
  unpaidCount,
  netBurnSatang,
  runwayMonths,
} from "@/lib/metrics/finance"
import { pipelineValue, weightedPipelineValue } from "@/lib/metrics/pipeline"
import { deriveInvoiceStatus } from "@/lib/metrics/invoice-status"
import {
  billableValueSatang,
  totalMinutes,
  minutesToHours,
  utilization,
} from "@/lib/metrics/timesheets"
import { sumSatang } from "@/lib/money"
import type { Enums } from "@/lib/types/database"

export type FollowUp = {
  id: string
  body: string | null
  type: Enums<"activity_type">
  due_date: string | null
}

export type DashboardData = {
  cashSatang: number
  monthlyRevenueSatang: number
  revenueHistory: { month: string; revenueSatang: number }[]
  monthlyBurnSatang: number
  netBurnSatang: number
  runwayMonths: number | null
  pipelineSatang: number
  weightedPipelineSatang: number
  /** MRR shown on the dashboard — subscriptions are the source of truth. */
  mrrSatang: number
  /** Recurring-invoice MRR, kept for reference/back-compat. */
  invoiceMrrSatang: number
  subscriptionMrrSatang: number
  openQuotesCount: number
  openQuotesValueSatang: number
  billableHoursThisMonth: number
  billableValueThisMonthSatang: number
  utilizationThisMonth: number
  unpaidSatang: number
  unpaidInvoiceCount: number
  overdueInvoiceCount: number
  activeProjectCount: number
  newClientsThisMonth: number
  followUpsDueToday: FollowUp[]
  overdueFollowUps: FollowUp[]
}

const ACTIVE_PROJECT_STATUSES: Enums<"project_status">[] = [
  "not_started",
  "in_progress",
  "review",
  "support",
]

const OPEN_QUOTE_STATUSES: Enums<"quote_status">[] = [
  "draft",
  "sent",
  "accepted",
]

/** Membership RLS permits all memberships; explicit org filters choose this workspace. */
export async function getDashboardData(): Promise<DashboardData> {
  const ctx = await requireOrgContext()
  const supabase = await createClient()
  const today = todayISO()
  const month = currentMonthKey()

  const [
    dealsRes,
    invoicesRes,
    paymentsRes,
    costsRes,
    projectsRes,
    activitiesRes,
    settingsRes,
    subscriptionsRes,
    quotesRes,
    timeEntriesRes,
    newClientsRes,
  ] = await Promise.all([
    readAll((from, to) => supabase.from("deals").select("stage,value_satang").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("invoices")
      .select("id,status,amount_satang,is_recurring,recurring_interval,due_date")
      .eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("payments").select("invoice_id,amount_satang,paid_at").eq("org_id", ctx.orgId).eq("verification_state", "verified").order("id").range(from, to)),
    readAll((from, to) => supabase.from("costs").select("amount_satang,incurred_on").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("projects").select("status").eq("org_id", ctx.orgId).order("id").range(from, to)),
    readAll((from, to) => supabase.from("activities").select("id,body,type,due_date,done").eq("org_id", ctx.orgId).order("id").range(from, to)),
    supabase
      .from("org_settings")
      .select("cash_balance_satang,monthly_burn_satang")
      .eq("org_id", ctx.orgId)
      .maybeSingle(),
    readAll((from, to) => supabase
      .from("subscriptions")
      .select("status,amount_satang,interval")
      .eq("org_id", ctx.orgId)
      .eq("status", "active").order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("quotes")
      .select("status,total_satang")
      .eq("org_id", ctx.orgId)
      .in("status", OPEN_QUOTE_STATUSES).order("id").range(from, to)),
    readAll((from, to) => supabase
      .from("time_entries")
      .select("project_id,minutes,billable,rate_satang,work_date")
      .eq("org_id", ctx.orgId)
      .gte("work_date", `${month}-01`)
      .lt("work_date", nextMonthStart(month)).order("id").range(from, to)),
    supabase
      .from("clients")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.orgId)
      .gte("created_at", startOfDayInstant(`${month}-01`))
      .lt("created_at", startOfDayInstant(nextMonthStart(month))),
  ])

  if ([dealsRes, invoicesRes, paymentsRes, costsRes, projectsRes, activitiesRes,
    settingsRes, subscriptionsRes, quotesRes, timeEntriesRes, newClientsRes].some((result) => result.error)) {
    throw new Error("Unable to load dashboard data. Please try again.")
  }

  const deals = dealsRes.data ?? []
  const invoices = invoicesRes.data ?? []
  const payments = paymentsRes.data ?? []
  const costs = costsRes.data ?? []
  const projects = projectsRes.data ?? []
  const activities = activitiesRes.data ?? []
  const settings = settingsRes.data
  const subscriptions = subscriptionsRes.data ?? []
  const quotes = quotesRes.data ?? []
  const timeEntries = timeEntriesRes.data ?? []

  const paidByInvoice = new Map<string, number>()
  for (const p of payments) {
    paidByInvoice.set(p.invoice_id, (paidByInvoice.get(p.invoice_id) ?? 0) + p.amount_satang)
  }

  const invoicesWithPaid = invoices.map((i) => ({
    status: i.status,
    amount_satang: i.amount_satang,
    paid_satang: paidByInvoice.get(i.id) ?? 0,
  }))

  const overdueInvoiceCount = invoices.filter(
    (i) =>
      deriveInvoiceStatus(
        { status: i.status, amount_satang: i.amount_satang, due_date: i.due_date },
        paidByInvoice.get(i.id) ?? 0,
        today
      ) === "overdue"
  ).length

  const subscriptionMrrSatang = subscriptionMrr(subscriptions)
  const openQuotesCount = quotes.length
  const openQuotesValueSatang = sumSatang(quotes.map((q) => q.total_satang))

  const billableHoursThisMonth = minutesToHours(totalMinutes(timeEntries))
  const billableValueThisMonthSatang = billableValueSatang(timeEntries)
  const utilizationThisMonth = utilization(timeEntries)

  const monthlyRevenueSatang = revenueForMonth(payments, month)
  const computedBurn = costsForMonth(costs, month)
  const monthlyBurnSatang = settings?.monthly_burn_satang ?? computedBurn
  const net = netBurnSatang(monthlyBurnSatang, monthlyRevenueSatang)
  const cashSatang = settings?.cash_balance_satang ?? 0

  const followUpsDueToday = activities
    .filter((a) => !a.done && a.due_date === today)
    .map(toFollowUp)
  const overdueFollowUps = activities
    .filter((a) => !a.done && isPastDue(a.due_date, today))
    .map(toFollowUp)

  return {
    cashSatang,
    monthlyRevenueSatang,
    revenueHistory: lastNMonths(6, month).map((month) => ({
      month,
      revenueSatang: revenueForMonth(payments, month),
    })),
    monthlyBurnSatang,
    netBurnSatang: net,
    runwayMonths: runwayMonths(cashSatang, net),
    pipelineSatang: pipelineValue(deals),
    weightedPipelineSatang: weightedPipelineValue(deals),
    // Subscriptions are the source of truth for MRR on the dashboard.
    mrrSatang: subscriptionMrrSatang,
    invoiceMrrSatang: mrr(invoices),
    subscriptionMrrSatang,
    openQuotesCount,
    openQuotesValueSatang,
    billableHoursThisMonth,
    billableValueThisMonthSatang,
    utilizationThisMonth,
    unpaidSatang: unpaidTotal(invoicesWithPaid),
    unpaidInvoiceCount: unpaidCount(invoicesWithPaid),
    overdueInvoiceCount,
    activeProjectCount: projects.filter((p) =>
      ACTIVE_PROJECT_STATUSES.includes(p.status)
    ).length,
    newClientsThisMonth: newClientsRes.count ?? 0,
    followUpsDueToday,
    overdueFollowUps,
  }
}

/** First day (YYYY-MM-DD) of the month after the given 'YYYY-MM' key. */
function nextMonthStart(month: string): string {
  const [year, mon] = month.split("-").map(Number)
  const nextYear = mon === 12 ? year + 1 : year
  const nextMon = mon === 12 ? 1 : mon + 1
  return `${nextYear}-${String(nextMon).padStart(2, "0")}-01`
}

function toFollowUp(a: {
  id: string
  body: string | null
  type: Enums<"activity_type">
  due_date: string | null
}): FollowUp {
  return { id: a.id, body: a.body, type: a.type, due_date: a.due_date }
}
