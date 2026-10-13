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
  const parsed = new Date(`${dateISO}T00:00:00Z`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateISO) || !Number.isFinite(parsed.getTime()) || toISO(parsed) !== dateISO) {
    throw new Error("Invalid date")
  }
  return parsed
}

/** Format a Date back to 'YYYY-MM-DD' from its UTC parts. */
function toISO(d: Date): string {
  return d.toISOString().slice(0, 10)
}

/** Advance an ISO date by one interval. */
export function addInterval(dateISO: string, interval: RecurringInterval, startISO = dateISO): string {
  const d = parseISO(dateISO)
  const anchor = parseISO(startISO)
  if (interval === "weekly") {
    d.setUTCDate(d.getUTCDate() + 7)
    return toISO(d)
  }
  const months = { monthly: 1, quarterly: 3, yearly: 12 }[interval]
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1))
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  target.setUTCDate(Math.min(anchor.getUTCDate(), lastDay))
  return toISO(target)
}

/**
 * Preview the next scheduled date after handling ONE due occurrence. Missed
 * periods remain due for repeated invocations. Database commands own the actual
 * schedule advancement; this helper never skips unbilled periods.
 */
export function nextRunAfter(
  fromISO: string,
  interval: RecurringInterval,
  todayISO: string,
  startISO = fromISO
): string {
  parseISO(fromISO)
  parseISO(todayISO)
  return fromISO <= todayISO ? addInterval(fromISO, interval, startISO) : fromISO
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
