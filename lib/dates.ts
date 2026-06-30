import { formatInTimeZone } from "date-fns-tz"

/** App timezone. The studio operates in Thailand; "today"/"this month" use this. */
export const APP_TZ = "Asia/Bangkok"

/** 'YYYY-MM-DD' for an instant in the app timezone. */
export function todayISO(now: Date = new Date(), tz: string = APP_TZ): string {
  return formatInTimeZone(now, tz, "yyyy-MM-dd")
}

/** 'YYYY-MM' for an instant (string or Date) in the app timezone. */
export function monthKey(instant: string | Date, tz: string = APP_TZ): string {
  const d = typeof instant === "string" ? new Date(instant) : instant
  return formatInTimeZone(d, tz, "yyyy-MM")
}

/** Current 'YYYY-MM' in the app timezone. */
export function currentMonthKey(now: Date = new Date(), tz: string = APP_TZ): string {
  return monthKey(now, tz)
}

/** True when an ISO date (YYYY-MM-DD) is strictly before today. Null → false. */
export function isPastDue(dueISO: string | null, todayISOStr: string): boolean {
  if (!dueISO) return false
  return dueISO < todayISOStr
}

/** Whole days from today to a target date (negative = past). Both YYYY-MM-DD. */
export function daysUntil(dateISO: string, todayISOStr: string): number {
  const today = Date.parse(`${todayISOStr}T00:00:00Z`)
  const target = Date.parse(`${dateISO}T00:00:00Z`)
  return Math.round((target - today) / 86_400_000)
}
