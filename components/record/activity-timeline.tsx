"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { loadRecordHistoryPage } from "@/lib/record-history/actions"
import type { RecordRef } from "@/lib/record-history/model"
import { mergeLoaded, timelineDay, type LoadedTimeline, type TimelinePage } from "@/lib/record-history/timeline"
import { ActivityAttachment } from "./activity-attachment"

export function ActivityTimeline({ record, initial, people, canViewAudit }: {
  record: RecordRef
  initial: TimelinePage
  people: { id: string; name: string }[]
  canViewAudit: boolean
}) {
  const [loaded, setLoaded] = useState<LoadedTimeline | null>(null)
  const [error, setError] = useState("")
  const [pending, startTransition] = useTransition()
  const { entries, cursor } = mergeLoaded(initial, loaded)
  const names = new Map(people.map(person => [person.id, person.name]))

  function loadOlder() {
    if (!cursor || pending) return
    setError("")
    startTransition(async () => {
      try {
        const result = await loadRecordHistoryPage({ ...record, cursor })
        const page = result.page
        if (!page) { setError(result.error || "Unable to load older history."); return }
        setLoaded({ entries: [...entries, ...page.timeline], cursor: page.nextCursor })
      } catch { setError("Unable to load older history. Please try again.") }
    })
  }
  return <section aria-label="Timeline" className="space-y-3">
    <h3 className="font-medium">Timeline</h3>
    {!canViewAudit ? <p className="text-muted-foreground text-xs">System audit entries are visible to owners and admins.</p> : null}
    {entries.length ? <ol className="space-y-3">{entries.map((entry, index) => <li key={entry.id}>
      {index === 0 || timelineDay(entries[index - 1].at) !== timelineDay(entry.at) ? <h4 className="text-muted-foreground mb-2 text-xs font-medium">{timelineDay(entry.at)}</h4> : null}
      <article className="space-y-1 border-l-2 pl-3">
        <p className="text-muted-foreground text-xs">{entry.actor ? names.get(entry.actor) || "Team member" : entry.kind === "activity" ? "Unknown completer" : "System"} · <time dateTime={entry.at}>{new Date(entry.at).toLocaleTimeString("en-GB", { timeZone: "Asia/Bangkok", hour: "2-digit", minute: "2-digit" })}</time> · {entry.kind}</p>
        {entry.attachmentId ? <ActivityAttachment id={entry.attachmentId} filename={entry.text} /> : <p className="whitespace-pre-wrap break-words text-sm">{entry.text}</p>}
      </article>
    </li>)}</ol> : <p className="text-muted-foreground text-sm">No history yet.</p>}
    {cursor ? <Button variant="outline" onClick={loadOlder} disabled={pending}>{pending ? "Loading…" : "Load older"}</Button> : null}
    {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
  </section>
}
