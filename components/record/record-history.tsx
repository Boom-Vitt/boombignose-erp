import { randomUUID } from "node:crypto"
import { todayISO } from "@/lib/dates"
import { recordHistory } from "@/lib/record-history/queries"
import { ACTIVITY_LABELS, type RecordRef } from "@/lib/record-history/model"
import { ActivityComposer } from "./activity-composer"
import { ActivityDone } from "./activity-done"
import { ActivityDue } from "./activity-due"
import { ActivityTimeline } from "./activity-timeline"

export async function RecordHistory(ref: RecordRef) {
  const history = await recordHistory(ref)
  const names = new Map(history.people.map(person => [person.id, person.name]))
  const today = todayISO()
  return <section aria-label="Record history" className="space-y-5 rounded-xl border bg-card p-4 md:p-6">
    <h2 className="text-lg font-semibold">Record history</h2>
    {history.canWrite ? <ActivityComposer {...ref} people={history.people} userId={history.userId} /> : null}
    <section aria-label="Planned activities" className="space-y-3">
      <h3 className="font-medium">Planned activities ({history.planned.length})</h3>
      {history.planned.length ? <ul className="divide-y rounded-lg border">{history.planned.map(activity => <li key={activity.id} className="flex flex-wrap items-center gap-3 p-3">
        <div className="min-w-0 flex-1 space-y-1"><p className="text-sm font-medium break-words">{ACTIVITY_LABELS[activity.type]} · {activity.body || "Activity"}</p>
          <ActivityDue dueDate={activity.due_date} today={today} />
          <p className="text-muted-foreground text-xs">{activity.owner ? names.get(activity.owner) || "Team member" : "Unassigned"}</p>
        </div>
        {history.canWrite ? <ActivityDone id={activity.id} /> : null}
      </li>)}</ul> : <p className="text-muted-foreground text-sm">No planned activities.</p>}
    </section>
    {/* Refresh older pages too when an activity is reopened beyond the first page. */}
    <ActivityTimeline
      key={randomUUID()}
      record={ref}
      initial={{ timeline: history.timeline, nextCursor: history.nextCursor }}
      people={history.people}
      canViewAudit={history.canViewAudit}
    />
  </section>
}
