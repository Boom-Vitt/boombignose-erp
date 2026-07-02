import { sumSatang, type Satang } from "@/lib/money"

/**
 * Timesheet aggregation. Time is stored as integer minutes; billable value is
 * derived as hours × per-hour rate (satang), rounded once to the nearest satang.
 */

export type TimeEntryLike = {
  project_id: string
  minutes: number
  billable: boolean
  rate_satang: number | null
}

/** Total minutes across entries. */
export function totalMinutes(entries: Pick<TimeEntryLike, "minutes">[]): number {
  return entries.reduce((acc, e) => acc + (e.minutes || 0), 0)
}

/** Minutes → decimal hours (e.g. 90 → 1.5). */
export function minutesToHours(minutes: number): number {
  return minutes / 60
}

/** Billable value of a single entry: hours × rate. Non-billable or unrated → 0. */
export function entryValueSatang(entry: TimeEntryLike): Satang {
  if (!entry.billable || entry.rate_satang == null) return 0
  return Math.round(minutesToHours(entry.minutes) * entry.rate_satang)
}

/** Sum of billable value across entries. */
export function billableValueSatang(entries: TimeEntryLike[]): Satang {
  return sumSatang(entries.map(entryValueSatang))
}

/** Group total minutes by project id. */
export function minutesByProject(
  entries: Pick<TimeEntryLike, "project_id" | "minutes">[]
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) {
    out[e.project_id] = (out[e.project_id] ?? 0) + (e.minutes || 0)
  }
  return out
}

/**
 * Utilization = billable minutes ÷ total minutes, in [0, 1]. Returns 0 when no
 * time is logged (avoids divide-by-zero).
 */
export function utilization(
  entries: Pick<TimeEntryLike, "minutes" | "billable">[]
): number {
  const total = entries.reduce((acc, e) => acc + (e.minutes || 0), 0)
  if (total === 0) return 0
  const billable = entries
    .filter((e) => e.billable)
    .reduce((acc, e) => acc + (e.minutes || 0), 0)
  return billable / total
}
