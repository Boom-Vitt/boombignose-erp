export type DueState = "overdue" | "today" | "future" | "none"
export const DUE_STYLES: Record<DueState, string> = {
  overdue: "text-red-600 dark:text-red-400",
  today: "text-orange-600 dark:text-orange-400",
  future: "text-green-700 dark:text-green-400",
  none: "text-muted-foreground",
}
export const DUE_LABELS: Record<DueState, string> = { overdue: "Overdue", today: "Today", future: "Future", none: "No due date" }

export function activityDueState(dueDate: string | null, today: string, done = false): DueState {
  if (done || !dueDate) return "none"
  return dueDate < today ? "overdue" : dueDate === today ? "today" : "future"
}
