import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { Enums } from "@/lib/types/database"

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

function Pill({ label, tone }: { label: string; tone: Tone }) {
  return (
    <Badge variant="outline" className={cn("font-medium", TONE[tone])}>
      {label}
    </Badge>
  )
}

const DEAL_STAGE: Record<Enums<"deal_stage">, { label: string; tone: Tone }> = {
  lead: { label: "Lead", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  discovery: { label: "Discovery", tone: "info" },
  proposal: { label: "Proposal", tone: "progress" },
  negotiation: { label: "Negotiation", tone: "warning" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
}

const PROJECT_STATUS: Record<Enums<"project_status">, { label: string; tone: Tone }> = {
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "progress" },
  review: { label: "Review", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  support: { label: "Support", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  cancelled: { label: "Cancelled", tone: "danger" },
}

const INVOICE_STATUS: Record<Enums<"invoice_status">, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
}

const TASK_STATUS: Record<Enums<"task_status">, { label: string; tone: Tone }> = {
  todo: { label: "To do", tone: "neutral" },
  in_progress: { label: "In progress", tone: "progress" },
  done: { label: "Done", tone: "success" },
}

export function DealStageBadge({ stage }: { stage: Enums<"deal_stage"> }) {
  const { label, tone } = DEAL_STAGE[stage]
  return <Pill label={label} tone={tone} />
}

export function ProjectStatusBadge({ status }: { status: Enums<"project_status"> }) {
  const { label, tone } = PROJECT_STATUS[status]
  return <Pill label={label} tone={tone} />
}

export function InvoiceStatusBadge({ status }: { status: Enums<"invoice_status"> }) {
  const { label, tone } = INVOICE_STATUS[status]
  return <Pill label={label} tone={tone} />
}

export function TaskStatusBadge({ status }: { status: Enums<"task_status"> }) {
  const { label, tone } = TASK_STATUS[status]
  return <Pill label={label} tone={tone} />
}
