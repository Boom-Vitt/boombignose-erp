import type { Enums } from "@/lib/types/database"

type QuoteStatus = Enums<"quote_status">
type InvoiceStatus = Enums<"invoice_status">
type DealStage = Enums<"deal_stage">
type ProjectStatus = Enums<"project_status">
type SubscriptionStatus = Enums<"subscription_status">
type TaskStatus = Enums<"task_status">

export type RecordStatus =
  | QuoteStatus
  | InvoiceStatus
  | DealStage
  | ProjectStatus
  | SubscriptionStatus
  | TaskStatus
  | Enums<"purchase_status">

export type Tone = "neutral" | "info" | "success" | "warning" | "danger"

/** One label and tone per status value, shared by every enum that uses the value. */
export const STATUS_DISPLAY: Record<RecordStatus, { label: string; tone: Tone }> = {
  confirmed: { label: "Confirmed", tone: "info" },
  received: { label: "Received", tone: "success" },
  billed: { label: "Billed", tone: "success" },
  draft: { label: "Draft", tone: "neutral" },
  sent: { label: "Sent", tone: "info" },
  accepted: { label: "Accepted", tone: "success" },
  declined: { label: "Declined", tone: "danger" },
  expired: { label: "Expired", tone: "warning" },
  converted: { label: "Converted", tone: "success" },
  partially_paid: { label: "Partially paid", tone: "warning" },
  paid: { label: "Paid", tone: "success" },
  overdue: { label: "Overdue", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
  lead: { label: "Lead", tone: "neutral" },
  contacted: { label: "Contacted", tone: "info" },
  discovery: { label: "Discovery", tone: "info" },
  proposal: { label: "Proposal", tone: "info" },
  negotiation: { label: "Negotiation", tone: "info" },
  won: { label: "Won", tone: "success" },
  lost: { label: "Lost", tone: "danger" },
  not_started: { label: "Not started", tone: "neutral" },
  in_progress: { label: "In progress", tone: "info" },
  review: { label: "Review", tone: "info" },
  delivered: { label: "Delivered", tone: "success" },
  support: { label: "Support", tone: "info" },
  paused: { label: "Paused", tone: "warning" },
  active: { label: "Active", tone: "success" },
  todo: { label: "To do", tone: "neutral" },
  done: { label: "Done", tone: "success" },
}

/** Steps a page performs with its own control instead of a plain status change. */
export type FlowCommand = "convert" | "issue" | "pay" | "create_project" | "send_rfq" | "receive" | "bill" | "deliver"

export type FlowAction<S extends string> =
  | { label: string; to: S }
  | { label: string; command: FlowCommand }

export type DocumentFlow<S extends string> = {
  /** The main line, drawn as chevrons in this order. */
  stages: readonly S[]
  /** Off-line statuses that still sit on a stage, e.g. an overdue invoice is still sent. */
  on?: Partial<Record<S, S>>
  /** At most one primary action: the next step. */
  next: Record<S, { primary?: FlowAction<S>; secondary?: readonly FlowAction<S>[] }>
}

const LOSE_DEAL = { label: "Mark lost", to: "lost" } as const

export const QUOTE_FLOW: DocumentFlow<QuoteStatus> = {
  stages: ["draft", "sent", "accepted", "converted"],
  next: {
    draft: { primary: { label: "Mark sent", to: "sent" } },
    sent: {
      primary: { label: "Accept", to: "accepted" },
      secondary: [{ label: "Decline", to: "declined" }],
    },
    accepted: { primary: { label: "Create project and draft invoice", command: "convert" } },
    declined: {},
    expired: {},
    converted: {},
  },
}

/** Keyed by the effective status (deriveInvoiceStatus), not the stored one. */
export const INVOICE_FLOW: DocumentFlow<InvoiceStatus> = {
  stages: ["draft", "sent", "paid"],
  on: { partially_paid: "sent", overdue: "sent" },
  next: {
    draft: { primary: { label: "Issue invoice", command: "issue" } },
    sent: { primary: { label: "Record payment", command: "pay" }, secondary: [{ label: "Deliver", command: "deliver" }] },
    partially_paid: { primary: { label: "Record payment", command: "pay" }, secondary: [{ label: "Deliver", command: "deliver" }] },
    overdue: { primary: { label: "Record payment", command: "pay" }, secondary: [{ label: "Deliver", command: "deliver" }] },
    paid: { secondary: [{ label: "Deliver", command: "deliver" }] },
    cancelled: {},
  },
}

export const DEAL_FLOW: DocumentFlow<DealStage> = {
  stages: ["lead", "contacted", "discovery", "proposal", "negotiation", "won"],
  next: {
    lead: { primary: { label: "Mark contacted", to: "contacted" }, secondary: [LOSE_DEAL] },
    contacted: { primary: { label: "Start discovery", to: "discovery" }, secondary: [LOSE_DEAL] },
    discovery: { primary: { label: "Move to proposal", to: "proposal" }, secondary: [LOSE_DEAL] },
    proposal: {
      primary: { label: "Start negotiation", to: "negotiation" },
      secondary: [{ label: "Mark won", to: "won" }, LOSE_DEAL],
    },
    negotiation: { primary: { label: "Mark won", to: "won" }, secondary: [LOSE_DEAL] },
    won: { primary: { label: "Create project", command: "create_project" } },
    lost: { secondary: [{ label: "Reopen", to: "lead" }] },
  },
}

export const PROJECT_FLOW: DocumentFlow<ProjectStatus> = {
  stages: ["not_started", "in_progress", "review", "delivered", "support"],
  next: {
    not_started: { primary: { label: "Start project", to: "in_progress" } },
    in_progress: {
      primary: { label: "Send for review", to: "review" },
      secondary: [{ label: "Pause", to: "paused" }],
    },
    review: {
      primary: { label: "Mark delivered", to: "delivered" },
      secondary: [{ label: "Back to in progress", to: "in_progress" }],
    },
    delivered: { primary: { label: "Start support", to: "support" } },
    support: {},
    paused: {
      primary: { label: "Resume", to: "in_progress" },
      secondary: [{ label: "Cancel project", to: "cancelled" }],
    },
    cancelled: {},
  },
}

export const SUBSCRIPTION_FLOW: DocumentFlow<SubscriptionStatus> = {
  stages: ["active"],
  next: {
    active: {
      secondary: [
        { label: "Pause", to: "paused" },
        { label: "Cancel subscription", to: "cancelled" },
      ],
    },
    paused: {
      primary: { label: "Activate", to: "active" },
      secondary: [{ label: "Cancel subscription", to: "cancelled" }],
    },
    cancelled: { primary: { label: "Activate", to: "active" } },
  },
}

export type StepState = "done" | "current" | "upcoming"

/**
 * What the status bar shows for a record. `available` drops actions the page
 * cannot offer (missing permission or handler); a dropped primary is not replaced.
 */
export function statusBar<S extends string>(
  flow: DocumentFlow<S>,
  status: S,
  available: (action: FlowAction<S>) => boolean = () => true
) {
  const at = flow.stages.includes(status) ? status : (flow.on?.[status] ?? null)
  const index = at === null ? -1 : flow.stages.indexOf(at)
  const { primary, secondary = [] } = flow.next[status]
  return {
    steps: flow.stages.map((value, i) => ({
      value,
      state: (i < index ? "done" : i === index ? "current" : "upcoming") as StepState,
    })),
    /** A status off the main line, shown as a badge beside the chevrons. */
    side: at === status ? null : status,
    primary: primary && available(primary) ? primary : null,
    secondary: secondary.filter(available),
  }
}

export const PURCHASE_FLOW: DocumentFlow<Enums<"purchase_status">> = {
  stages: ["draft", "sent", "confirmed", "received", "billed"],
  next: {
    draft: { primary: { label: "Send RFQ", command: "send_rfq" }, secondary: [{ label: "Confirm", to: "confirmed" }, { label: "Cancel", to: "cancelled" }] },
    sent: { primary: { label: "Confirm", to: "confirmed" }, secondary: [{ label: "Cancel", to: "cancelled" }] },
    confirmed: { primary: { label: "Receive", command: "receive" }, secondary: [{ label: "Create bill", command: "bill" }, { label: "Cancel", to: "cancelled" }] },
    received: { primary: { label: "Create bill", command: "bill" } },
    billed: {},
    cancelled: {},
  },
}
