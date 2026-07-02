/**
 * Pure calendar helpers. Everything operates on numeric `year`/`month`
 * (month is 1-12) and ISO 'YYYY-MM-DD' date strings. No timezone/`Date`
 * mutation surprises: date arithmetic goes through `Date.UTC`, which is a
 * fixed reference and never touches the host timezone.
 */

/** A single cell in the month grid. */
export type CalendarDay = {
  /** ISO 'YYYY-MM-DD'. */
  iso: string
  /** Day-of-month number (1-31). */
  day: number
  /** True when this day belongs to the requested month (not a spill-over). */
  inMonth: boolean
}

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

/** Two-digit zero-pad for month/day fragments. */
function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** ISO 'YYYY-MM-DD' for a UTC-normalized year/month(0-indexed)/day triple. */
function isoFromUTC(year: number, monthIndex: number, day: number): CalendarDay {
  const d = new Date(Date.UTC(year, monthIndex, day))
  const y = d.getUTCFullYear()
  const mi = d.getUTCMonth()
  const dd = d.getUTCDate()
  return { iso: `${y}-${pad2(mi + 1)}-${pad2(dd)}`, day: dd, inMonth: false }
}

/**
 * A 6×7 grid (rows = weeks, columns = Mon…Sun) of ISO dates covering `month`,
 * padded with the trailing days of the previous month and leading days of the
 * next month so every row is full. `inMonth` flags the requested month's days.
 *
 * @param year  full year, e.g. 2026
 * @param month 1-12
 */
export function monthMatrix(year: number, month: number): CalendarDay[][] {
  const monthIndex = month - 1
  // getUTCDay: 0=Sun…6=Sat. Shift so Monday=0 … Sunday=6.
  const firstWeekday = new Date(Date.UTC(year, monthIndex, 1)).getUTCDay()
  const leading = (firstWeekday + 6) % 7

  const weeks: CalendarDay[][] = []
  for (let week = 0; week < 6; week++) {
    const row: CalendarDay[] = []
    for (let col = 0; col < 7; col++) {
      const offset = week * 7 + col - leading
      const cell = isoFromUTC(year, monthIndex, 1 + offset)
      cell.inMonth = cell.iso.slice(0, 7) === `${year}-${pad2(month)}`
      row.push(cell)
    }
    weeks.push(row)
  }
  return weeks
}

/**
 * Bucket items carrying an ISO `date` field by that date. Order within each
 * bucket follows input order (stable).
 */
export function groupByDate<T extends { date: string }>(
  items: readonly T[]
): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const item of items) {
    ;(out[item.date] ??= []).push(item)
  }
  return out
}

/** Human label for a month, e.g. `monthLabel(2026, 7)` → "July 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** 'YYYY-MM' key for a year/month pair. */
export function formatMonthKey(year: number, month: number): string {
  return `${year}-${pad2(month)}`
}

/**
 * Parse a 'YYYY-MM' key into `{ year, month }` (month 1-12). Returns `null`
 * for anything that is not a valid month key so callers can fall back.
 */
export function parseMonthKey(
  key: string | null | undefined
): { year: number; month: number } | null {
  if (!key) return null
  const m = /^(\d{4})-(\d{2})$/.exec(key)
  if (!m) return null
  const year = Number(m[1])
  const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month }
}

/** Previous month, rolling the year back across January. */
export function prevMonth(ym: { year: number; month: number }): {
  year: number
  month: number
} {
  return ym.month === 1
    ? { year: ym.year - 1, month: 12 }
    : { year: ym.year, month: ym.month - 1 }
}

/** Next month, rolling the year forward across December. */
export function nextMonth(ym: { year: number; month: number }): {
  year: number
  month: number
} {
  return ym.month === 12
    ? { year: ym.year + 1, month: 1 }
    : { year: ym.year, month: ym.month + 1 }
}
