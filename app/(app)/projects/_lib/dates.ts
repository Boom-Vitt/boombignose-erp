/**
 * Deadline display helpers for the Projects module.
 * Dates are stored as YYYY-MM-DD (date columns) with no time component.
 */

import { daysUntil, todayISO } from "@/lib/dates"

const fmt = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
})

export type DeadlineMeta = {
  label: string
  note: string | null
  tone: "default" | "warning" | "danger"
}

/**
 * Format a deadline with a relative note and tone:
 *  - overdue (past)  → danger
 *  - due within 7 days → warning
 *  - otherwise → default (no note)
 */
export function deadlineMeta(date: string | null): DeadlineMeta | null {
  if (!date) return null
  const label = fmt.format(new Date(`${date}T00:00:00`))
  // "Today" is the Bangkok calendar day; the server's own clock is UTC.
  const diff = daysUntil(date, todayISO())

  if (diff < 0) {
    const d = Math.abs(diff)
    return {
      label,
      note: d === 1 ? "1 day overdue" : `${d} days overdue`,
      tone: "danger",
    }
  }
  if (diff === 0) return { label, note: "Due today", tone: "warning" }
  if (diff <= 7) {
    return {
      label,
      note: diff === 1 ? "Due tomorrow" : `In ${diff} days`,
      tone: "warning",
    }
  }
  return { label, note: null, tone: "default" }
}

/** Plain date format with no relative note (for tasks/milestones). */
export function formatDate(date: string | null): string {
  if (!date) return "—"
  return fmt.format(new Date(`${date}T00:00:00`))
}
