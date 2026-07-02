import { addWeeks, addMonths, addQuarters, addYears } from "date-fns"

import type { Enums } from "@/lib/types/database"

/**
 * Pure recurring-billing math for subscriptions. Dates are ISO 'YYYY-MM-DD'
 * strings in the app's terms (no timezone math needed for whole-day cadences).
 * The cron endpoint uses these to decide which subscriptions are due and to
 * advance next_run_date after generating an invoice.
 */

export type RecurringInterval = Enums<"recurring_interval">

export type SubscriptionLike = {
  id: string
  status: Enums<"subscription_status">
  auto_generate: boolean
  next_run_date: string
  interval: RecurringInterval
}

/** Parse 'YYYY-MM-DD' to a Date at UTC midnight (stable, DST-free). */
function parseISO(dateISO: string): Date {
  return new Date(`${dateISO}T00:00:00Z`)
}

/** Format a Date back to 'YYYY-MM-DD' from its UTC parts. */
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Advance an ISO date by one interval. */
export function addInterval(dateISO: string, interval: RecurringInterval): string {
  const d = parseISO(dateISO)
  switch (interval) {
    case "weekly":
      return toISO(addWeeks(d, 1))
    case "monthly":
      return toISO(addMonths(d, 1))
    case "quarterly":
      return toISO(addQuarters(d, 1))
    case "yearly":
      return toISO(addYears(d, 1))
  }
}

/**
 * Advance a run date forward until it is strictly after `today`. Guarantees the
 * next scheduled run is in the future even if several periods were missed (the
 * cron generates one invoice per pass; the caller loops if it wants to backfill).
 */
export function nextRunAfter(
  fromISO: string,
  interval: RecurringInterval,
  todayISO: string
): string {
  let next = fromISO
  // Bounded to avoid an infinite loop on bad data.
  for (let i = 0; i < 1000 && next <= todayISO; i++) {
    next = addInterval(next, interval)
  }
  return next
}

/** A subscription is due when active, auto-generating, and scheduled on/before today. */
export function isDue(sub: SubscriptionLike, todayISO: string): boolean {
  return (
    sub.status === "active" &&
    sub.auto_generate &&
    sub.next_run_date <= todayISO
  )
}

/** Filter to the subscriptions the cron should generate invoices for today. */
export function dueSubscriptions<T extends SubscriptionLike>(
  subs: T[],
  todayISO: string
): T[] {
  return subs.filter((s) => isDue(s, todayISO))
}
