import { monthKey, todayISO } from "@/lib/dates"

export const PERIODS = {
  this_month: "This month",
  last_month: "Last month",
  this_quarter: "This quarter",
  this_year: "This year",
} as const
export type Period = keyof typeof PERIODS

/** Bangkok calendar dates, with an exclusive end. */
export function periodRange(period: Period, now: Date = new Date()) {
  const [year, month] = monthKey(now).split("-").map(Number)
  const startMonth = period === "this_year" ? 1
    : period === "this_quarter" ? Math.floor((month - 1) / 3) * 3 + 1
    : period === "last_month" ? month - 1 : month
  const length = period === "this_year" ? 12 : period === "this_quarter" ? 3 : 1
  const date = (m: number) => new Date(Date.UTC(year, m - 1, 1)).toISOString().slice(0, 10)
  return { start: date(startMonth), end: date(startMonth + length) }
}

export function inPeriod(value: string, period: Period, now: Date = new Date()): boolean {
  const date = value.length === 10 ? value : todayISO(new Date(value))
  const { start, end } = periodRange(period, now)
  return date >= start && date < end
}
