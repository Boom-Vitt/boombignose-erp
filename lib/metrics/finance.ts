import { monthKey } from "@/lib/dates"
import { sumSatang, type Satang } from "@/lib/money"
import { outstandingSatang } from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"

export type PaymentLike = { amount_satang: number; paid_at: string }
export type CostLike = { amount_satang: number; incurred_on: string }

export type CostApprovalStatus = Enums<"cost_approval_status">
/** A cost carrying its approval status, for approvals-aware spend/burn. */
export type CostWithApproval = CostLike & {
  approval_status: CostApprovalStatus
}

export type RecurringInvoiceLike = {
  status: Enums<"invoice_status">
  amount_satang: number
  is_recurring: boolean
  recurring_interval: Enums<"recurring_interval"> | null
}

export type InvoiceWithPaid = {
  status: Enums<"invoice_status">
  amount_satang: number
  paid_satang: number
}

export type SubscriptionLike = {
  status: Enums<"subscription_status">
  amount_satang: number
  interval: Enums<"recurring_interval">
}

/** Sum of payments received in the given 'YYYY-MM' (app timezone). */
export function revenueForMonth(
  payments: PaymentLike[],
  monthKeyStr: string,
  tz?: string
): Satang {
  return sumSatang(
    payments
      .filter((p) => monthKey(p.paid_at, tz) === monthKeyStr)
      .map((p) => p.amount_satang)
  )
}

/** Sum of costs incurred in the given 'YYYY-MM' (app timezone). */
export function costsForMonth(
  costs: CostLike[],
  monthKeyStr: string,
  tz?: string
): Satang {
  return sumSatang(
    costs
      .filter((c) => monthKey(c.incurred_on, tz) === monthKeyStr)
      .map((c) => c.amount_satang)
  )
}

/**
 * Whether a cost counts toward spend/burn totals. Only `rejected` costs are
 * excluded; `pending` and `approved` still count (dashboards stay unchanged
 * until something is explicitly rejected).
 */
export function isCountableCost(status: CostApprovalStatus): boolean {
  return status !== "rejected"
}

/**
 * Like {@link costsForMonth} but approvals-aware: rejected costs are dropped
 * before summing. Pending and approved costs still count.
 */
export function countableCostsForMonth(
  costs: CostWithApproval[],
  monthKeyStr: string,
  tz?: string
): Satang {
  return sumSatang(
    costs
      .filter(
        (c) =>
          isCountableCost(c.approval_status) &&
          monthKey(c.incurred_on, tz) === monthKeyStr
      )
      .map((c) => c.amount_satang)
  )
}

/** Normalize a recurring interval to a per-month multiplier. */
const MONTHLY_FACTOR: Record<Enums<"recurring_interval">, number> = {
  weekly: 52 / 12,
  monthly: 1,
  quarterly: 1 / 3,
  yearly: 1 / 12,
}

/**
 * Monthly Recurring Revenue: recurring invoices normalized to a monthly figure.
 * Draft and cancelled invoices are excluded.
 */
export function mrr(invoices: RecurringInvoiceLike[]): Satang {
  const total = invoices
    .filter(
      (i) =>
        i.is_recurring &&
        i.recurring_interval !== null &&
        i.status !== "draft" &&
        i.status !== "cancelled"
    )
    .reduce(
      (acc, i) =>
        acc + i.amount_satang * MONTHLY_FACTOR[i.recurring_interval!],
      0
    )
  return Math.round(total)
}

/**
 * Monthly Recurring Revenue from subscriptions (the source of truth for MRR).
 * Only `active` subscriptions count; each amount is normalized to a monthly
 * figure using the same per-interval factors as {@link mrr}.
 */
export function subscriptionMrr(subs: SubscriptionLike[]): Satang {
  const total = subs
    .filter((s) => s.status === "active")
    .reduce((acc, s) => acc + s.amount_satang * MONTHLY_FACTOR[s.interval], 0)
  return Math.round(total)
}

/** Total still owed across all non-draft, non-cancelled, not-fully-paid invoices. */
export function unpaidTotal(invoices: InvoiceWithPaid[]): Satang {
  return sumSatang(
    invoices
      .filter(
        (i) =>
          i.status !== "draft" &&
          i.status !== "cancelled" &&
          i.status !== "paid"
      )
      .map((i) => outstandingSatang(i.amount_satang, i.paid_satang))
  )
}

/** Count of invoices with any outstanding balance (excl. draft/cancelled/paid). */
export function unpaidCount(invoices: InvoiceWithPaid[]): number {
  return invoices.filter(
    (i) =>
      i.status !== "draft" &&
      i.status !== "cancelled" &&
      i.status !== "paid" &&
      outstandingSatang(i.amount_satang, i.paid_satang) > 0
  ).length
}

/** Net monthly burn = costs − revenue. Positive means cash is being spent. */
export function netBurnSatang(
  monthlyCostsSatang: Satang,
  monthlyRevenueSatang: Satang
): Satang {
  return monthlyCostsSatang - monthlyRevenueSatang
}

/**
 * Runway in months = cash / net monthly burn.
 * Returns null when not burning (net burn <= 0) — i.e. effectively infinite.
 */
export function runwayMonths(
  cashSatang: Satang,
  monthlyNetBurnSatang: Satang
): number | null {
  if (monthlyNetBurnSatang <= 0) return null
  return cashSatang / monthlyNetBurnSatang
}
