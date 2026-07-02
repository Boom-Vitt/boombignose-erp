import { formatInTimeZone } from "date-fns-tz"

/**
 * Pure presentation helpers for the audit / activity feed.
 *
 * Deliberately DB-independent: they take plain fields (not Supabase rows) so the
 * logic can be unit-tested without a database. The `audit_log` row's
 * human-readable `summary` is authored at write time; these helpers only label,
 * prefix, and time-stamp it for display.
 */

/** Audit feed timezone — the studio operates in Thailand. */
const FEED_TZ = "Asia/Bangkok"

/** The fields the feed needs to render one entry. */
export type AuditView = {
  actorEmail?: string | null
  action: string
  entity: string
  /** Human sentence authored at write time. Optional for legacy/partial rows. */
  summary?: string | null
}

/** Friendly past-tense labels for the actions we emit. */
const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  deleted: "Deleted",
  stage_changed: "Stage changed",
  payment_recorded: "Payment recorded",
}

/**
 * Display name for who performed the action. Falls back to "System" when there
 * is no actor email (e.g. automated/system writes or a deleted user).
 */
export function actorName(email: string | null | undefined): string {
  const trimmed = (email ?? "").trim()
  return trimmed === "" ? "System" : trimmed
}

/**
 * Friendly label for an action verb. Known actions get a curated label; unknown
 * snake_case actions are humanized (e.g. `invoice_sent` -> "Invoice sent")
 * rather than throwing, so new actions degrade gracefully.
 */
export function actionLabel(action: string): string {
  const key = action.trim()
  if (key === "") return "Activity"
  if (ACTION_LABELS[key]) return ACTION_LABELS[key]
  const words = key.replace(/_/g, " ").trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/**
 * A clean one-line sentence for the feed: the actor's name followed by the
 * authored summary. When no summary exists we synthesize one from the action
 * label and entity so the row is never blank.
 */
export function auditSentence(entry: AuditView): string {
  const who = actorName(entry.actorEmail)
  const summary = (entry.summary ?? "").trim()
  if (summary !== "") return `${who} ${summary}`
  return `${who} ${actionLabel(entry.action)} ${entry.entity}`.trimEnd()
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * Relative time for a timestamp ("just now", "5 minutes ago", "2 days ago"),
 * falling back to an absolute Bangkok-local date for anything older than a week.
 * Returns "" for an unparseable input so the caller can render nothing.
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ""

  const diff = now.getTime() - then
  if (diff < MINUTE) return "just now"

  if (diff < HOUR) {
    const m = Math.floor(diff / MINUTE)
    return `${m} ${m === 1 ? "minute" : "minutes"} ago`
  }
  if (diff < DAY) {
    const h = Math.floor(diff / HOUR)
    return `${h} ${h === 1 ? "hour" : "hours"} ago`
  }
  if (diff < 7 * DAY) {
    const d = Math.floor(diff / DAY)
    return `${d} ${d === 1 ? "day" : "days"} ago`
  }

  return formatInTimeZone(then, FEED_TZ, "d MMM yyyy")
}
