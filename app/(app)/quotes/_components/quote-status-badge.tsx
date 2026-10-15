import { Pill, type Tone } from "@/components/status-badge"
import type { Enums } from "@/lib/types/database"

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
  return <Pill label={label} tone={tone} />
}
