import Link from "next/link"
import { myActivities } from "@/lib/record-history/queries"
import { activityDueState, DUE_STYLES } from "@/lib/record-history/due"
import { todayISO } from "@/lib/dates"

export async function ActivityCounter() {
  const activities = await myActivities()
  const counts = { overdue: 0, today: 0, future: 0, none: 0 }
  const today = todayISO()
  for (const activity of activities) counts[activityDueState(activity.due_date, today, activity.done)]++
  return <Link href="/activities" className="ml-auto flex flex-wrap items-center gap-x-2 rounded px-2 py-1 text-xs hover:bg-muted" aria-label={`My activities: ${counts.overdue} late, ${counts.today} today, ${counts.future} future`}>
    <span>My activities</span><span className={DUE_STYLES.overdue}>{counts.overdue} late</span><span className={DUE_STYLES.today}>{counts.today} today</span><span className={DUE_STYLES.future}>{counts.future} future</span>
  </Link>
}
