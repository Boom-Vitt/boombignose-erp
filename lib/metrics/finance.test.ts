import { describe, it, expect } from "vitest"

import {
  revenueForMonth,
  costsForMonth,
  isCountableCost,
  countableCostsForMonth,
  mrr,
  subscriptionMrr,
  unpaidTotal,
  unpaidCount,
  netBurnSatang,
  runwayMonths,
  type PaymentLike,
  type CostLike,
  type CostWithApproval,
  type RecurringInvoiceLike,
  type InvoiceWithPaid,
  type SubscriptionLike,
} from "@/lib/metrics/finance"

describe("revenueForMonth", () => {
  const payments: PaymentLike[] = [
    { amount_satang: 100_000, paid_at: "2026-06-10T05:00:00Z" },
    { amount_satang: 50_000, paid_at: "2026-06-20T05:00:00Z" },
    { amount_satang: 999, paid_at: "2026-05-31T05:00:00Z" },
  ]

  it("sums payments within the target Bangkok month", () => {
    expect(revenueForMonth(payments, "2026-06")).toBe(150_000)
    expect(revenueForMonth(payments, "2026-05")).toBe(999)
    expect(revenueForMonth(payments, "2026-07")).toBe(0)
  })
})

describe("costsForMonth", () => {
  it("sums costs within the target month", () => {
    const costs: CostLike[] = [
      { amount_satang: 30_000, incurred_on: "2026-06-05" },
      { amount_satang: 20_000, incurred_on: "2026-06-25" },
      { amount_satang: 10_000, incurred_on: "2026-07-01" },
    ]
    expect(costsForMonth(costs, "2026-06")).toBe(50_000)
  })
})

describe("isCountableCost", () => {
  it("counts pending and approved, excludes rejected", () => {
    expect(isCountableCost("pending")).toBe(true)
    expect(isCountableCost("approved")).toBe(true)
    expect(isCountableCost("rejected")).toBe(false)
  })
})

describe("countableCostsForMonth", () => {
  const costs: CostWithApproval[] = [
    { amount_satang: 30_000, incurred_on: "2026-06-05", approval_status: "pending" },
    { amount_satang: 20_000, incurred_on: "2026-06-25", approval_status: "approved" },
    { amount_satang: 99_000, incurred_on: "2026-06-15", approval_status: "rejected" },
    { amount_satang: 10_000, incurred_on: "2026-07-01", approval_status: "approved" },
  ]

  it("sums pending + approved costs within the month, ignoring rejected", () => {
    expect(countableCostsForMonth(costs, "2026-06")).toBe(50_000)
  })

  it("excludes costs outside the target month", () => {
    expect(countableCostsForMonth(costs, "2026-07")).toBe(10_000)
  })

  it("is zero when every cost in the month is rejected", () => {
    const rejected: CostWithApproval[] = [
      { amount_satang: 40_000, incurred_on: "2026-06-10", approval_status: "rejected" },
    ]
    expect(countableCostsForMonth(rejected, "2026-06")).toBe(0)
  })
})

describe("mrr", () => {
  it("normalizes recurring intervals to a monthly figure", () => {
    const invoices: RecurringInvoiceLike[] = [
      { status: "sent", amount_satang: 120_000, is_recurring: true, recurring_interval: "monthly" },
      { status: "paid", amount_satang: 1_200_000, is_recurring: true, recurring_interval: "yearly" },
      { status: "sent", amount_satang: 300_000, is_recurring: true, recurring_interval: "quarterly" },
      { status: "sent", amount_satang: 999_999, is_recurring: false, recurring_interval: null },
      { status: "draft", amount_satang: 500_000, is_recurring: true, recurring_interval: "monthly" },
    ]
    // 120000 + 100000 + 100000 = 320000
    expect(mrr(invoices)).toBe(320_000)
  })

  it("rounds weekly normalization", () => {
    const invoices: RecurringInvoiceLike[] = [
      { status: "sent", amount_satang: 10_000, is_recurring: true, recurring_interval: "weekly" },
    ]
    // 10000 * 52/12 = 43333.33 -> 43333
    expect(mrr(invoices)).toBe(43_333)
  })
})

describe("subscriptionMrr", () => {
  it("normalizes each interval to a monthly figure for active subs", () => {
    const subs: SubscriptionLike[] = [
      { status: "active", amount_satang: 120_000, interval: "monthly" },
      { status: "active", amount_satang: 1_200_000, interval: "yearly" },
      { status: "active", amount_satang: 300_000, interval: "quarterly" },
    ]
    // 120000 + 100000 + 100000 = 320000
    expect(subscriptionMrr(subs)).toBe(320_000)
  })

  it("rounds weekly normalization", () => {
    const subs: SubscriptionLike[] = [
      { status: "active", amount_satang: 10_000, interval: "weekly" },
    ]
    // 10000 * 52/12 = 43333.33 -> 43333
    expect(subscriptionMrr(subs)).toBe(43_333)
  })

  it("excludes paused and cancelled subscriptions", () => {
    const subs: SubscriptionLike[] = [
      { status: "active", amount_satang: 120_000, interval: "monthly" },
      { status: "paused", amount_satang: 500_000, interval: "monthly" },
      { status: "cancelled", amount_satang: 900_000, interval: "monthly" },
    ]
    expect(subscriptionMrr(subs)).toBe(120_000)
  })

  it("is zero with no active subscriptions", () => {
    expect(subscriptionMrr([])).toBe(0)
    expect(
      subscriptionMrr([
        { status: "paused", amount_satang: 100_000, interval: "monthly" },
      ])
    ).toBe(0)
  })
})

describe("unpaidTotal / unpaidCount", () => {
  const invoices: InvoiceWithPaid[] = [
    { status: "sent", amount_satang: 100_000, paid_satang: 0 },
    { status: "partially_paid", amount_satang: 100_000, paid_satang: 60_000 },
    { status: "paid", amount_satang: 100_000, paid_satang: 100_000 },
    { status: "draft", amount_satang: 50_000, paid_satang: 0 },
    { status: "cancelled", amount_satang: 50_000, paid_satang: 0 },
    { status: "overdue", amount_satang: 80_000, paid_satang: 0 },
  ]

  it("sums outstanding across collectible invoices", () => {
    // 100000 + 40000 + 80000
    expect(unpaidTotal(invoices)).toBe(220_000)
  })

  it("counts collectible invoices with a balance", () => {
    expect(unpaidCount(invoices)).toBe(3)
  })
})

describe("netBurn and runway", () => {
  it("net burn is costs minus revenue", () => {
    expect(netBurnSatang(500_000, 300_000)).toBe(200_000)
    expect(netBurnSatang(300_000, 500_000)).toBe(-200_000)
  })

  it("runway divides cash by net burn", () => {
    expect(runwayMonths(1_000_000, 200_000)).toBe(5)
  })

  it("runway is null (infinite) when not burning", () => {
    expect(runwayMonths(1_000_000, 0)).toBeNull()
    expect(runwayMonths(1_000_000, -50_000)).toBeNull()
  })
})
