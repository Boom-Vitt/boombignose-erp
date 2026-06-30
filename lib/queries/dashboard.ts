import { createClient } from "@/lib/supabase/server"
import { currentMonthKey, todayISO, isPastDue } from "@/lib/dates"
import {
  revenueForMonth,
  costsForMonth,
  mrr,
  unpaidTotal,
  unpaidCount,
  netBurnSatang,
  runwayMonths,
} from "@/lib/metrics/finance"
import { pipelineValue, weightedPipelineValue } from "@/lib/metrics/pipeline"
import { deriveInvoiceStatus } from "@/lib/metrics/invoice-status"
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
  monthlyBurnSatang: number
  netBurnSatang: number
  runwayMonths: number | null
  pipelineSatang: number
  weightedPipelineSatang: number
  mrrSatang: number
  unpaidSatang: number
  unpaidInvoiceCount: number
  overdueInvoiceCount: number
  activeProjectCount: number
  followUpsDueToday: FollowUp[]
  overdueFollowUps: FollowUp[]
}

const ACTIVE_PROJECT_STATUSES: Enums<"project_status">[] = [
  "not_started",
  "in_progress",
  "review",
  "support",
]

/** Fetches the org's data (RLS-scoped to the session) and derives dashboard metrics. */
export async function getDashboardData(): Promise<DashboardData> {
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
  ] = await Promise.all([
    supabase.from("deals").select("stage,value_satang"),
    supabase
      .from("invoices")
      .select("id,status,amount_satang,is_recurring,recurring_interval,due_date"),
    supabase.from("payments").select("invoice_id,amount_satang,paid_at"),
    supabase.from("costs").select("amount_satang,incurred_on"),
    supabase.from("projects").select("status"),
    supabase.from("activities").select("id,body,type,due_date,done"),
    supabase
      .from("org_settings")
      .select("cash_balance_satang,monthly_burn_satang")
      .maybeSingle(),
  ])

  const deals = dealsRes.data ?? []
  const invoices = invoicesRes.data ?? []
  const payments = paymentsRes.data ?? []
  const costs = costsRes.data ?? []
  const projects = projectsRes.data ?? []
  const activities = activitiesRes.data ?? []
  const settings = settingsRes.data

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
    monthlyBurnSatang,
    netBurnSatang: net,
    runwayMonths: runwayMonths(cashSatang, net),
    pipelineSatang: pipelineValue(deals),
    weightedPipelineSatang: weightedPipelineValue(deals),
    mrrSatang: mrr(invoices),
    unpaidSatang: unpaidTotal(invoicesWithPaid),
    unpaidInvoiceCount: unpaidCount(invoicesWithPaid),
    overdueInvoiceCount,
    activeProjectCount: projects.filter((p) =>
      ACTIVE_PROJECT_STATUSES.includes(p.status)
    ).length,
    followUpsDueToday,
    overdueFollowUps,
  }
}

function toFollowUp(a: {
  id: string
  body: string | null
  type: Enums<"activity_type">
  due_date: string | null
}): FollowUp {
  return { id: a.id, body: a.body, type: a.type, due_date: a.due_date }
}
