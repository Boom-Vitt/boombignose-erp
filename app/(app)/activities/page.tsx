import Link from "next/link"
import { PageHeader } from "@/components/page-header"
import { ActivityDone } from "@/components/record/activity-done"
import { ActivityDue } from "@/components/record/activity-due"
import { todayISO } from "@/lib/dates"
import { activityDueState, DUE_LABELS, DUE_STYLES, type DueState } from "@/lib/record-history/due"
import { ACTIVITY_LABELS, recordHref } from "@/lib/record-history/model"
import { myActivities } from "@/lib/record-history/queries"

export const dynamic = "force-dynamic"
export default async function ActivitiesPage() {
  const activities = await myActivities()
  const today = todayISO()
  return <div className="space-y-6">
    <PageHeader title="My activities" description="Your open activities in the active workspace" />
    {(["overdue", "today", "future", "none"] as DueState[]).map(state => {
      const group = activities.filter(activity => activityDueState(activity.due_date, today, activity.done) === state)
      return <section key={state} aria-label={DUE_LABELS[state]} className="space-y-3">
        <h2 className={`font-semibold ${DUE_STYLES[state]}`}>{DUE_LABELS[state]} ({group.length})</h2>
        {group.length ? <ul className="divide-y rounded-lg border">{group.map(activity => <li key={activity.id} className="flex flex-wrap items-center gap-3 p-4">
          <div className="min-w-0 flex-1 space-y-1"><p className="break-words text-sm font-medium">{ACTIVITY_LABELS[activity.type]} · {activity.body || "Activity"}</p>
            <ActivityDue dueDate={activity.due_date} today={today} />
            {activity.record_type && activity.record_id ? <Link href={recordHref(activity.record_type, activity.record_id)} className="block text-sm underline">Open {activity.record_type}</Link> : null}
          </div><ActivityDone id={activity.id} />
        </li>)}</ul> : <p className="text-muted-foreground text-sm">No activities.</p>}
      </section>
    })}
  </div>
}
