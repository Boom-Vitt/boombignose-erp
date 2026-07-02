import { describe, it, expect } from "vitest"

import {
  dueFollowUps,
  type DealFollowUp,
  type ActivityFollowUp,
} from "@/lib/automation/rules"

const TODAY = "2026-06-30"

// Deals: open stages with a follow-up date on/before today should produce specs;
// future, won, lost, or null-date deals must be excluded.
const deals: DealFollowUp[] = [
  { id: "deal-today", title: "Due today deal", next_follow_up_date: TODAY, stage: "proposal" },
  { id: "deal-overdue", title: "Overdue deal", next_follow_up_date: "2026-06-28", stage: "negotiation" },
  { id: "deal-future", title: "Future deal", next_follow_up_date: "2026-07-05", stage: "lead" },
  { id: "deal-won", title: "Won deal", next_follow_up_date: TODAY, stage: "won" },
  { id: "deal-lost", title: "Lost deal", next_follow_up_date: "2026-06-01", stage: "lost" },
  { id: "deal-null", title: "No follow-up date", next_follow_up_date: null, stage: "discovery" },
]

// Activities: not-done with a due date on/before today produce specs; future,
// done, or null-date activities must be excluded. `type` is NOT a filter.
const activities: ActivityFollowUp[] = [
  { id: "act-today", title: "Due today call", due_date: TODAY, done: false, type: "follow_up" },
  { id: "act-overdue", title: "Overdue call", due_date: "2026-06-28", done: false, type: "call" },
  { id: "act-future", title: "Future meeting", due_date: "2026-07-03", done: false, type: "meeting" },
  { id: "act-done", title: "Already done", due_date: "2026-06-20", done: true, type: "follow_up" },
  { id: "act-null", title: "No due date", due_date: null, done: false, type: "note" },
]

describe("dueFollowUps", () => {
  it("returns an empty list for empty input", () => {
    expect(dueFollowUps([], [], TODAY)).toEqual([])
  })

  it("includes deals due today and overdue, excluding future/won/lost/null", () => {
    const specs = dueFollowUps(deals, [], TODAY)
    const ids = specs.map((s) => s.entityId).sort()
    expect(ids).toEqual(["deal-overdue", "deal-today"])
    expect(specs.every((s) => s.entity === "deal")).toBe(true)
  })

  it("includes activities due today and overdue, excluding future/done/null", () => {
    const specs = dueFollowUps([], activities, TODAY)
    const ids = specs.map((s) => s.entityId).sort()
    expect(ids).toEqual(["act-overdue", "act-today"])
    expect(specs.every((s) => s.entity === "activity")).toBe(true)
  })

  it("does not filter activities by type (a 'call' still counts when due)", () => {
    const callOnly: ActivityFollowUp[] = [
      { id: "act-call", due_date: "2026-06-29", done: false, type: "call" },
    ]
    const specs = dueFollowUps([], callOnly, TODAY)
    expect(specs).toHaveLength(1)
    expect(specs[0]!.entityId).toBe("act-call")
  })

  it("combines deals and activities and carries through title + dueDate", () => {
    const specs = dueFollowUps(deals, activities, TODAY)
    expect(specs).toHaveLength(4)

    const today = specs.find((s) => s.entityId === "deal-today")
    expect(today).toEqual({
      entity: "deal",
      entityId: "deal-today",
      title: "Due today deal",
      dueDate: TODAY,
    })

    const overdueAct = specs.find((s) => s.entityId === "act-overdue")
    expect(overdueAct).toEqual({
      entity: "activity",
      entityId: "act-overdue",
      title: "Overdue call",
      dueDate: "2026-06-28",
    })
  })

  it("falls back to a derived title when an activity has no title", () => {
    const noTitle: ActivityFollowUp[] = [
      { id: "act-x", due_date: TODAY, done: false, type: "follow_up" },
    ]
    const specs = dueFollowUps([], noTitle, TODAY)
    expect(specs[0]!.title.length).toBeGreaterThan(0)
    // Derived from the activity type so the reminder is still meaningful.
    expect(specs[0]!.title.toLowerCase()).toContain("follow")
  })

  it("treats a follow-up dated exactly today as due (boundary)", () => {
    const boundary: DealFollowUp[] = [
      { id: "d", title: "Boundary", next_follow_up_date: TODAY, stage: "contacted" },
    ]
    expect(dueFollowUps(boundary, [], TODAY)).toHaveLength(1)
  })
})
