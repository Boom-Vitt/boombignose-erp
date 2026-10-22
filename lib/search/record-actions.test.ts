import { describe, expect, it } from "vitest"

import { DEAL_FLOW, INVOICE_FLOW, QUOTE_FLOW } from "@/lib/record/status"
import { paletteActions, recordFromPath } from "./record-actions"

const ID = "3f1c2b6e-8a4d-4e2f-9b7a-1c2d3e4f5a6b"

describe("palette record actions", () => {
  it("finds the record on detail pages only", () => {
    expect(recordFromPath(`/quotes/${ID}`)).toEqual({ type: "quote", id: ID })
    expect(recordFromPath(`/finance/invoices/${ID}`)).toEqual({ type: "invoice", id: ID })
    expect(recordFromPath(`/finance/subscriptions/${ID}`)).toEqual({ type: "subscription", id: ID })
    expect(recordFromPath("/quotes/new")).toBeNull()
    expect(recordFromPath(`/deals/${ID}/edit`)).toBeNull()
    expect(recordFromPath(`/clients/${ID}`)).toBeNull()
    expect(recordFromPath("/dashboard")).toBeNull()
  })

  it("offers the StatusBar's primary then secondary actions", () => {
    expect(paletteActions(QUOTE_FLOW, "draft", true, {})).toEqual([{ label: "Mark sent", to: "sent" }])
    expect(paletteActions(DEAL_FLOW, "proposal", true, {})).toEqual([
      { label: "Start negotiation", to: "negotiation" },
      { label: "Mark won", to: "won" },
      { label: "Mark lost", to: "lost" },
    ])
  })

  it("drops status changes without a transition and commands without a handler", () => {
    expect(paletteActions(QUOTE_FLOW, "sent", false, {})).toEqual([])
    expect(paletteActions(QUOTE_FLOW, "accepted", true, {})).toEqual([])
    expect(paletteActions(INVOICE_FLOW, "overdue", false, { pay: "/finance/invoices/x#payment-claims" })).toEqual([
      { label: "Record payment", href: "/finance/invoices/x#payment-claims" },
    ])
    expect(paletteActions(QUOTE_FLOW, "accepted", true, { convert: true })).toEqual([
      { label: "Create project and draft invoice", command: "convert" },
    ])
  })
})
