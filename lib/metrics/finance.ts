import { monthKey } from "@/lib/dates"
import { sumSatang, type Satang } from "@/lib/money"
import { outstandingSatang } from "@/lib/metrics/invoice-status"
import type { Enums } from "@/lib/types/database"

export type RevenueInvoice = { status: Enums<"invoice_status">; issue_date: string; total_satang: number; vat_satang: number }
export type CostLike = { amount_satang: number; incurred_on: string }

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

/** Issued invoice base before VAT and WHT, recognized in the issue month. */
export function revenueForMonth(
  invoices: RevenueInvoice[],
  monthKeyStr: string,
  tz?: string
): Satang {
  return sumSatang(
    invoices
      .filter((i) => i.status !== "draft" && i.status !== "cancelled" && monthKey(i.issue_date, tz) === monthKeyStr)
      .map((i) => i.total_satang - i.vat_satang)
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

/** Normalize a recurring interval to a per-month multiplier. */
const MONTHLY_TWELFTHS: Record<Enums<"recurring_interval">, number> = {
  weekly: 52, monthly: 12, quarterly: 4, yearly: 1,
}

/** Normalize the whole forecast exactly, then round once; it is not cash. */
function normalizedMonthly(values: { amount_satang: number; interval: Enums<"recurring_interval"> }[]): Satang {
  let twelfths = BigInt(0)
  for (const value of values) {
    if (!Number.isSafeInteger(value.amount_satang) || value.amount_satang < 0) throw new Error("MRR amount outside safe satang bounds")
    twelfths += BigInt(value.amount_satang) * BigInt(MONTHLY_TWELFTHS[value.interval])
  }
  const total = (twelfths + BigInt(6)) / BigInt(12)
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("MRR total outside safe satang bounds")
  return Number(total)
}

/**
 * Monthly Recurring Revenue: recurring invoices normalized to a monthly figure.
 * Draft and cancelled invoices are excluded.
 */
export function mrr(invoices: RecurringInvoiceLike[]): Satang {
  return normalizedMonthly(invoices.filter(i => i.is_recurring && i.recurring_interval !== null && i.status !== "draft" && i.status !== "cancelled").map(i => ({ amount_satang: i.amount_satang, interval: i.recurring_interval! })))
}

/**
 * Monthly Recurring Revenue from subscriptions (the source of truth for MRR).
 * Only `active` subscriptions count; each amount is normalized to a monthly
 * figure using the same per-interval factors as {@link mrr}.
 */
export function subscriptionMrr(subs: SubscriptionLike[]): Satang {
  return normalizedMonthly(subs.filter(s => s.status === "active"))
}

/** Total still owed across all non-draft, non-cancelled, not-fully-paid invoices. */
export function unpaidTotal(invoices: InvoiceWithPaid[]): Satang {
  return sumSatang(
    invoices
      .filter(
        (i) =>
          i.status !== "draft" &&
          i.status !== "cancelled"
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
      outstandingSatang(i.amount_satang, i.paid_satang) > 0
  ).length
}

/** Net monthly cash burn = costs less verified receipts. Positive means cash is spent. */
export function netBurnSatang(
  monthlyCostsSatang: Satang,
  monthlyCashReceivedSatang: Satang
): Satang {
  return monthlyCostsSatang - monthlyCashReceivedSatang
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
