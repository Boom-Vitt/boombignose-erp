import Link from "next/link"
import { myActivityCounts } from "@/lib/record-history/queries"
import { DUE_STYLES } from "@/lib/record-history/due"

export async function ActivityCounter() {
  const counts = await myActivityCounts()
  return <Link href="/activities" prefetch={false} className="ml-auto flex min-w-0 shrink-0 items-center gap-x-2 rounded px-2 py-1 text-xs hover:bg-muted" aria-label={`My activities: ${counts.overdue} late, ${counts.today} today, ${counts.future} future`}>
    <span className="sm:hidden">Activity</span>
    <span className="max-sm:sr-only">My activities</span>
    <span className={`${DUE_STYLES.overdue} max-sm:sr-only`}>{counts.overdue} late</span>
    <span className={`${DUE_STYLES.today} max-sm:sr-only`}>{counts.today} today</span>
    <span className={`${DUE_STYLES.future} max-sm:sr-only`}>{counts.future} future</span>
  </Link>
}
