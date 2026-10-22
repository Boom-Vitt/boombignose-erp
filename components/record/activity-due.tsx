import { activityDueState, DUE_LABELS, DUE_STYLES } from "@/lib/record-history/due"

export function ActivityDue({ dueDate, today, done = false }: { dueDate: string | null; today: string; done?: boolean }) {
  const state = activityDueState(dueDate, today, done)
  return <span className={`text-xs ${DUE_STYLES[state]}`}>{done ? "Completed" : DUE_LABELS[state]}{dueDate ? ` · ${dueDate}` : ""}</span>
}
