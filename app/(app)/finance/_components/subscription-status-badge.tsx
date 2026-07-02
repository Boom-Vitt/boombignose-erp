import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Enums } from "@/lib/types/database"

// Local badge for subscription_status. The shared components/status-badge.tsx is
// owned by another module, so we mirror its tone styling here self-contained.
const STATUS: Record<
  Enums<"subscription_status">,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className:
      "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-transparent",
  },
  paused: {
    label: "Paused",
    className:
      "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-300 border-transparent",
  },
  cancelled: {
    label: "Cancelled",
    className: "bg-muted text-muted-foreground border-transparent",
  },
}

export function SubscriptionStatusBadge({
  status,
}: {
  status: Enums<"subscription_status">
}) {
  const { label, className } = STATUS[status]
  return (
    <Badge variant="outline" className={cn("font-medium", className)}>
      {label}
    </Badge>
  )
}
