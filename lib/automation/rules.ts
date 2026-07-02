/**
 * Pure follow-up rules. DB-independent so it can be unit-tested in isolation and
 * reused by the cron scan. Dates are compared as 'YYYY-MM-DD' strings (lexical
 * order == chronological order for this format — same convention as
 * `lib/dates.ts` `isPastDue`). A follow-up is DUE when its date is on or before
 * `todayISO`; future dates and null dates never qualify.
 */

import type { Enums } from "@/lib/types/database"

/** A deal projected to just the fields the rule needs. */
export type DealFollowUp = {
  id: string
  title: string
  next_follow_up_date: string | null
  stage: Enums<"deal_stage">
}

/** An activity projected to just the fields the rule needs. `title` optional. */
export type ActivityFollowUp = {
  id: string
  title?: string | null
  due_date: string | null
  done: boolean
  type: Enums<"activity_type">
}

/** What the rule emits per due item; consumed by the dispatch layer. */
export type ReminderSpec = {
  entity: "deal" | "activity"
  entityId: string
  title: string
  dueDate: string
}

/** Deal stages that are closed and therefore never need a follow-up reminder. */
const CLOSED_STAGES: ReadonlySet<Enums<"deal_stage">> = new Set(["won", "lost"])

/** True when an ISO date (YYYY-MM-DD) is today or earlier. Null → false. */
function isDueOrOverdue(dateISO: string | null, todayISO: string): boolean {
  if (!dateISO) return false
  return dateISO <= todayISO
}

/** Human label for an activity that has no explicit title, derived from its type. */
function activityTitleFallback(type: Enums<"activity_type">): string {
  const labels: Record<Enums<"activity_type">, string> = {
    note: "Follow up on note",
    call: "Follow up: call",
    email: "Follow up: email",
    meeting: "Follow up: meeting",
    follow_up: "Follow-up due",
  }
  return labels[type] ?? "Follow-up due"
}

/**
 * Given deals + activities and today's Bangkok date, return reminder specs for
 * every item that is due or overdue. Excludes won/lost deals, done activities,
 * and any item without a date. Order: deals first, then activities, each in
 * input order (callers may re-sort).
 */
export function dueFollowUps(
  deals: DealFollowUp[],
  activities: ActivityFollowUp[],
  todayISO: string
): ReminderSpec[] {
  const specs: ReminderSpec[] = []

  for (const deal of deals) {
    if (CLOSED_STAGES.has(deal.stage)) continue
    if (!isDueOrOverdue(deal.next_follow_up_date, todayISO)) continue
    specs.push({
      entity: "deal",
      entityId: deal.id,
      title: deal.title,
      dueDate: deal.next_follow_up_date as string,
    })
  }

  for (const activity of activities) {
    if (activity.done) continue
    if (!isDueOrOverdue(activity.due_date, todayISO)) continue
    const title = activity.title?.trim() || activityTitleFallback(activity.type)
    specs.push({
      entity: "activity",
      entityId: activity.id,
      title,
      dueDate: activity.due_date as string,
    })
  }

  return specs
}
