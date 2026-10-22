import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import { STATUS_DISPLAY, type RecordStatus, type Tone } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"

const TONE: Record<Tone, string> = {
  neutral: "bg-muted text-muted-foreground border-transparent",
  info: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border-transparent",
  success:
    "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border-transparent",
  warning:
    "bg-orange-100 text-orange-900 dark:bg-orange-950 dark:text-orange-300 border-transparent",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300 border-transparent",
}

export function StatusBadge({ status }: { status: RecordStatus }) {
  const { label, tone } = STATUS_DISPLAY[status]
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[tone])}>
      {label}
    </Badge>
  )
}

export function DealStageBadge({ stage }: { stage: Enums<"deal_stage"> }) {
  return <StatusBadge status={stage} />
}

export function ProjectStatusBadge({ status }: { status: Enums<"project_status"> }) {
  return <StatusBadge status={status} />
}

export function InvoiceStatusBadge({ status }: { status: Enums<"invoice_status"> }) {
  return <StatusBadge status={status} />
}

export function TaskStatusBadge({ status }: { status: Enums<"task_status"> }) {
  return <StatusBadge status={status} />
}

export function QuoteStatusBadge({ status }: { status: Enums<"quote_status"> }) {
  return <StatusBadge status={status} />
}

export function SubscriptionStatusBadge({ status }: { status: Enums<"subscription_status"> }) {
  return <StatusBadge status={status} />
}
