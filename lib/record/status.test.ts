import { describe, expect, it } from "vitest"

import { Constants } from "@/lib/types/database"
import { quoteTransitionError } from "@/lib/workflows/service"
import {
  DEAL_FLOW,
  INVOICE_FLOW,
  PROJECT_FLOW,
  PURCHASE_FLOW,
  QUOTE_FLOW,
  STATUS_DISPLAY,
  SUBSCRIPTION_FLOW,
  statusBar,
  type DocumentFlow,
  type FlowAction,
} from "./status"

const FLOWS: Array<[string, DocumentFlow<string>, readonly string[]]> = [
  ["quote", QUOTE_FLOW, Constants.public.Enums.quote_status],
  ["invoice", INVOICE_FLOW, Constants.public.Enums.invoice_status],
  ["deal", DEAL_FLOW, Constants.public.Enums.deal_stage],
  ["project", PROJECT_FLOW, Constants.public.Enums.project_status],
  ["subscription", SUBSCRIPTION_FLOW, Constants.public.Enums.subscription_status],
  ["purchase", PURCHASE_FLOW, Constants.public.Enums.purchase_status],
]

function actions<S extends string>(flow: DocumentFlow<S>, status: S): FlowAction<S>[] {
  const { primary, secondary } = statusBar(flow, status)
  return [...(primary ? [primary] : []), ...secondary]
}

describe("semantic status tones", () => {
  it.each([
    ["draft", "neutral"],
    ["sent", "info"],
    ["in_progress", "info"],
    ["accepted", "success"],
    ["paid", "success"],
    ["won", "success"],
    ["overdue", "danger"],
    ["lost", "danger"],
    ["declined", "danger"],
    ["partially_paid", "warning"],
  ] as const)("%s is %s", (status, tone) => {
    expect(STATUS_DISPLAY[status].tone).toBe(tone)
  })
})

describe.each(FLOWS)("%s flow", (_name, flow, statuses) => {
  it("plans every status of the enum", () => {
    expect(Object.keys(flow.next).sort()).toEqual([...statuses].sort())
  })

  it("keeps terminal side states off the chevrons and shows them as a badge", () => {
    for (const status of ["declined", "lost", "cancelled"].filter((s) => statuses.includes(s))) {
      const bar = statusBar(flow, status)
      expect(bar.steps.map((s) => s.value)).not.toContain(status)
      expect(bar.side).toBe(status)
      expect(bar.steps.some((s) => s.state === "current")).toBe(false)
    }
  })

  it("never offers a transition to the status the record already has", () => {
    for (const status of statuses) {
      for (const action of actions(flow, status)) {
        if ("to" in action) expect(action.to).not.toBe(status)
      }
    }
  })
})

describe("destructive transitions", () => {
  const flows = [...FLOWS, ["purchase", PURCHASE_FLOW, Constants.public.Enums.purchase_status] as const]
  it.each(flows)("every %s move to lost, declined or cancelled asks first", (_name, flow, statuses) => {
    for (const status of statuses) {
      for (const action of actions(flow as DocumentFlow<string>, status)) {
        if (!("to" in action)) continue
        const destructive = ["lost", "declined", "cancelled"].includes(action.to)
        expect(Boolean(action.confirm), `${status} → ${action.to}`).toBe(destructive)
        // Lost deals and declined quotes keep why; the other moves have no reason in this domain.
        expect(Boolean(action.reason), `${status} → ${action.to}`).toBe(["lost", "declined"].includes(action.to))
      }
    }
  })
})

describe("statusBar", () => {
  it("marks earlier stages done, the current one current, later ones upcoming", () => {
    const bar = statusBar(DEAL_FLOW, "proposal")
    expect(bar.steps.map((s) => s.state)).toEqual([
      "done", "done", "done", "current", "upcoming", "upcoming",
    ])
    expect(bar.side).toBeNull()
    expect(bar.primary).toEqual({ label: "Start negotiation", to: "negotiation" })
  })

  it("keeps an overdue invoice on the sent stage and flags it with a badge", () => {
    const bar = statusBar(INVOICE_FLOW, "overdue")
    expect(bar.steps.find((s) => s.state === "current")?.value).toBe("sent")
    expect(bar.side).toBe("overdue")
    expect(bar.primary).toEqual({ label: "Record payment", command: "pay" })
  })

  it("asks for a lost reason: Mark lost is a page command, never a bare stage change", () => {
    for (const stage of Constants.public.Enums.deal_stage) {
      for (const action of actions(DEAL_FLOW, stage)) {
        expect("to" in action && action.to === "lost").toBe(false)
      }
    }
    expect(actions(DEAL_FLOW, "negotiation")).toContainEqual({ label: "Mark lost", command: "lose" })
  })

  it("drops actions the page cannot offer without promoting a secondary", () => {
    const bar = statusBar(QUOTE_FLOW, "sent", (a) => !("to" in a && a.to === "accepted"))
    expect(bar.primary).toBeNull()
    expect(bar.secondary).toEqual([expect.objectContaining({ label: "Decline", to: "declined" })])
  })
})

describe("quote flow matches the server transition rules", () => {
  it.each(Constants.public.Enums.quote_status)("every %s transition is accepted by setQuoteStatus", (status) => {
    for (const action of actions(QUOTE_FLOW, status)) {
      if ("to" in action) expect(quoteTransitionError(status, action.to, null, "2026-10-23")).toBeNull()
    }
  })
})

it("places a closed purchase on received and offers billing without more receipt", () => {
  const bar = statusBar(PURCHASE_FLOW, "closed")
  expect(bar.steps.find(step => step.state === "current")?.value).toBe("received")
  expect(bar.primary).toEqual({ label: "Create bill", command: "bill" })
  expect(bar.secondary).toEqual([])
})
