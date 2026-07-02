import { cn } from "@/lib/utils"

/** Dot + label pairs describing the colour coding used across day cells. */
const LEGEND: { label: string; className: string }[] = [
  { label: "Follow-up", className: "bg-amber-500" },
  { label: "Meeting", className: "bg-violet-500" },
  { label: "Call", className: "bg-blue-500" },
  { label: "Email / Note", className: "bg-muted-foreground" },
  { label: "Invoice due", className: "bg-red-500" },
  { label: "Project deadline", className: "bg-emerald-500" },
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
