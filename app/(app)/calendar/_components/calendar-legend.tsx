import { cn } from "@/lib/utils"

/** Dot + label pairs describing the colour coding used across day cells. */
const LEGEND: { label: string; className: string }[] = [
  { label: "Overdue activity / invoice", className: "bg-red-500" },
  { label: "Activity today", className: "bg-orange-500" },
  { label: "Future activity / project deadline", className: "bg-emerald-500" },
  { label: "Completed activity", className: "bg-muted-foreground" },
]

export function CalendarLegend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
      {LEGEND.map((l) => (
        <span key={l.label} className="inline-flex items-center gap-1.5">
          <span className={cn("size-2 rounded-full", l.className)} />
          {l.label}
        </span>
      ))}
    </div>
  )
}
