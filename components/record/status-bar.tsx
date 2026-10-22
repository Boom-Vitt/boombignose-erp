import { Fragment } from "react"
import Link from "next/link"

import { cn } from "@/lib/utils"
import {
  STATUS_DISPLAY,
  statusBar,
  type DocumentFlow,
  type FlowAction,
  type FlowCommand,
  type RecordStatus,
} from "@/lib/record/status"
import { StatusBadge } from "@/components/status-badge"
import { Button } from "@/components/ui/button"
import { TransitionButton } from "./transition-button"

type Variant = "default" | "outline"

/** A link target, or a control the page renders itself (e.g. an idempotent command). */
export type CommandHandler =
  | string
  | ((props: { label: string; variant: Variant }) => React.ReactNode)

// Phones show only the current step so it never scrolls out of view.
const STEP_STATE = {
  done: "bg-muted text-foreground max-sm:hidden",
  current: "bg-primary text-primary-foreground font-medium",
  upcoming: "bg-muted/60 text-muted-foreground max-sm:hidden",
}

export function StatusBar<S extends RecordStatus>({
  label,
  flow,
  status,
  transition,
  commands = {},
}: {
  /** Accessible name of the stage list, e.g. "Quote status". */
  label: string
  flow: DocumentFlow<S>
  status: S
  /** Bound server action for plain status changes; omit to hide them. */
  transition?: (to: S) => Promise<{ error?: string }>
  /** Handlers for the commands this page can offer to this user. */
  commands?: Partial<Record<FlowCommand, CommandHandler>>
}) {
  const bar = statusBar(flow, status, (a) => ("to" in a ? !!transition : !!commands[a.command]))
  const actions = [
    ...(bar.primary ? [{ action: bar.primary, variant: "default" as const }] : []),
    ...bar.secondary.map((action) => ({ action, variant: "outline" as const })),
  ]

  function render(action: FlowAction<S>, variant: Variant) {
    if ("to" in action) {
      return (
        <TransitionButton
          key={action.label}
          label={action.label}
          to={action.to}
          transition={transition!}
          variant={variant}
        />
      )
    }
    const handler = commands[action.command]!
    if (typeof handler === "string") {
      return (
        <Button key={action.label} size="sm" variant={variant} render={<Link href={handler} />}>
          {action.label}
        </Button>
      )
    }
    return <Fragment key={action.label}>{handler({ label: action.label, variant })}</Fragment>
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-2 sm:flex-row sm:flex-wrap sm:items-center">
      {actions.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.map(({ action, variant }) => render(action, variant))}
        </div>
      ) : null}
      <div className="flex min-w-0 items-center gap-2 sm:ml-auto">
        {bar.side ? <StatusBadge status={bar.side} /> : null}
        <ol aria-label={label} className="flex min-w-0 overflow-x-auto">
          {bar.steps.map((step) => (
            <li
              key={step.value}
              aria-current={step.state === "current" ? "step" : undefined}
              className={cn(
                "-ml-1.5 py-1.5 pr-4 pl-5 text-xs whitespace-nowrap first:ml-0 first:pl-3",
                "[clip-path:polygon(0_0,calc(100%-0.5rem)_0,100%_50%,calc(100%-0.5rem)_100%,0_100%,0.5rem_50%)]",
                "first:[clip-path:polygon(0_0,calc(100%-0.5rem)_0,100%_50%,calc(100%-0.5rem)_100%,0_100%)]",
                STEP_STATE[step.state]
              )}
            >
              {STATUS_DISPLAY[step.value].label}
            </li>
          ))}
        </ol>
      </div>
    </div>
  )
}
