import { sumSatang, type Satang } from "@/lib/money"

/**
 * Pure aggregation helpers for the Reports module. Everything here is a plain
 * function over plain shapes — no Supabase, no dates library, no I/O — so it is
 * trivially unit-testable and timezone-agnostic. Callers pass in precomputed
 * month keys (see {@link revenueByClientMonth}) so bucketing stays deterministic.
 *
 * Money stays in integer satang throughout; only presentation-layer helpers
 * (hours = minutes / 60) produce non-integers, and never for money.
 */

/** A generic pivot table: rows × columns of a numeric measure, with totals. */
export type Pivot = {
  /** Distinct row keys, sorted ascending. */
  rowKeys: string[]
  /** Distinct column keys, sorted ascending. */
  colKeys: string[]
  /** Value at (row, col). Missing intersections are 0. */
  cell(rowKey: string, colKey: string): number
  /** Sum across all columns for a row. */
  rowTotal(rowKey: string): number
  /** Sum across all rows for a column. */
  colTotal(colKey: string): number
  /** Sum of every cell. */
  grandTotal: number
}

/**
 * Build a pivot table from arbitrary rows. `rowKey`/`colKey` bucket each row,
 * `valueFn` extracts the numeric measure; values for the same (row, col) pair
 * are summed. Row and column keys are returned sorted for stable rendering.
 */
export function pivot<Row>(
  rows: Row[],
  rowKey: (row: Row) => string,
  colKey: (row: Row) => string,
  valueFn: (row: Row) => number
): Pivot {
  // rowKey -> colKey -> summed value
  const grid = new Map<string, Map<string, number>>()
  const rowKeySet = new Set<string>()
  const colKeySet = new Set<string>()
  let grandTotal = 0

  for (const row of rows) {
    const r = rowKey(row)
    const c = colKey(row)
    const v = valueFn(row)
    rowKeySet.add(r)
    colKeySet.add(c)
    grandTotal += v

    let byCol = grid.get(r)
    if (!byCol) {
      byCol = new Map<string, number>()
      grid.set(r, byCol)
    }
    byCol.set(c, (byCol.get(c) ?? 0) + v)
  }

  const rowKeys = [...rowKeySet].sort()
  const colKeys = [...colKeySet].sort()

  const cell = (r: string, c: string): number => grid.get(r)?.get(c) ?? 0

  const rowTotal = (r: string): number => {
    const byCol = grid.get(r)
    if (!byCol) return 0
    let total = 0
    for (const v of byCol.values()) total += v
    return total
  }

  const colTotal = (c: string): number => {
    let total = 0
    for (const byCol of grid.values()) total += byCol.get(c) ?? 0
    return total
  }

  return { rowKeys, colKeys, cell, rowTotal, colTotal, grandTotal }
}

/** A single payment for the revenue pivot. Money is integer satang. */
export type ClientPayment = {
  client_name: string
  amount_satang: Satang
  paid_at: string
}

/**
 * Pivot of payment satang by client (rows) × month 'YYYY-MM' (columns).
 * `monthKeyOf` maps a payment's `paid_at` to its month string, keeping this
 * function timezone-agnostic — the caller decides the calendar.
 */
export function revenueByClientMonth(
  payments: ClientPayment[],
  monthKeyOf: (paidAt: string) => string
): Pivot {
  return pivot(
    payments,
    (p) => p.client_name,
    (p) => monthKeyOf(p.paid_at),
    (p) => p.amount_satang
  )
}

/** A single time entry for the hours-by-project rollup. */
export type ProjectTimeEntry = {
  project_name: string
  minutes: number
  billable: boolean
}

/** Rolled-up hours for one project. Minutes are integers; hours are derived. */
export type ProjectHours = {
  project_name: string
  totalMinutes: number
  billableMinutes: number
  nonBillableMinutes: number
  totalHours: number
  billableHours: number
}

/** Convert integer minutes to hours (2 decimals) for display only. */
export function minutesToHours(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

/**
 * Minutes/hours per project with a billable split, plus an overall total row.
 * Projects are sorted by name for stable rendering.
 */
export function hoursByProject(entries: ProjectTimeEntry[]): {
  projects: ProjectHours[]
  totalMinutes: number
  billableMinutes: number
  totalHours: number
  billableHours: number
} {
  const byProject = new Map<
    string,
    { totalMinutes: number; billableMinutes: number }
  >()

  for (const e of entries) {
    let agg = byProject.get(e.project_name)
    if (!agg) {
      agg = { totalMinutes: 0, billableMinutes: 0 }
      byProject.set(e.project_name, agg)
    }
    agg.totalMinutes += e.minutes
    if (e.billable) agg.billableMinutes += e.minutes
  }

  const projects: ProjectHours[] = [...byProject.entries()]
    .map(([project_name, agg]) => ({
      project_name,
      totalMinutes: agg.totalMinutes,
      billableMinutes: agg.billableMinutes,
      nonBillableMinutes: agg.totalMinutes - agg.billableMinutes,
      totalHours: minutesToHours(agg.totalMinutes),
      billableHours: minutesToHours(agg.billableMinutes),
    }))
    .sort((a, b) => a.project_name.localeCompare(b.project_name))

  const totalMinutes = projects.reduce((s, p) => s + p.totalMinutes, 0)
  const billableMinutes = projects.reduce((s, p) => s + p.billableMinutes, 0)

  return {
    projects,
    totalMinutes,
    billableMinutes,
    totalHours: minutesToHours(totalMinutes),
    billableHours: minutesToHours(billableMinutes),
  }
}

/**
 * Billable value = billable minutes × hourly rate, in integer satang.
 * Rate is satang-per-hour; result is rounded to whole satang (no float storage).
 */
export function billableValueSatang(
  billableMinutes: number,
  hourlyRateSatang: Satang
): Satang {
  return Math.round((billableMinutes / 60) * hourlyRateSatang)
}

/** Sum of all payment satang — a convenience total for the range StatCard. */
export function totalRevenueSatang(payments: ClientPayment[]): Satang {
  return sumSatang(payments.map((p) => p.amount_satang))
}
