import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Enums } from "@/lib/types/database"

// Local badge for quotes: the shared components/status-badge.tsx is owned by the
// coordinator and has no quote_status variant, so we mirror its tone system here.
type Tone = "neutral" | "info" | "progress" | "success" | "warning" | "danger"

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-transparent",
  progress:
    "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300 border-transparent",
  success:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-transparent",
  warning:
    "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border-transparent",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-transparent",
}

const QUOTE_STATUS: Record<Enums<"quote_status">, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "warning" },
  converted: { label: "Converted", tone: "progress" },
}

export function QuoteStatusBadge({ status }: { status: Enums<"quote_status"> }) {
  const { label, tone } = QUOTE_STATUS[status]
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[tone])}>
      {label}
    </Badge>
  )
}
