import { formatInTimeZone, fromZonedTime } from "date-fns-tz"

/** App timezone. The studio operates in Thailand; "today"/"this month" use this. */
export const APP_TZ = "Asia/Bangkok"

/**
 * Day/month/Buddhist-era year for a Gregorian `YYYY-MM-DD` date, for example
 * `2026-10-28` → `28/10/2569`. Invalid calendar dates return null.
 */
export function buddhistEraLabel(isoDate: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate)
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const utc = new Date(Date.UTC(year, month - 1, day))
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) return null
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year + 543}`
}

/** Keep the ISO date and append its Buddhist-era label when the date is real. */
export function withBuddhistEra(isoDate: string): string {
  const label = buddhistEraLabel(isoDate)
  return label ? `${isoDate} (${label})` : isoDate
}

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

/** UTC ISO instant of local midnight on a 'YYYY-MM-DD' date in the app timezone. */
export function startOfDayInstant(dateISO: string, tz: string = APP_TZ): string {
  return fromZonedTime(`${dateISO}T00:00:00`, tz).toISOString()
}

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
