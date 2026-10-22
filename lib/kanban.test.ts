import { describe, it, expect } from "vitest"

import {
  activityCounts,
  activityState,
  afterForDrop,
  dueState,
  earliestDate,
  groupCards,
  hasTypedInput,
  initials,
  moveCard,
  movedCardFocus,
  parseFolded,
  reorderAfter,
  serialQueue,
  type KanbanCard,
  type KanbanColumn,
} from "@/lib/kanban"

type Stage = "lead" | "proposal" | "won"

const columns: KanbanColumn<Stage>[] = [
  { id: "lead", label: "Lead" },
  { id: "proposal", label: "Proposal" },
  { id: "won", label: "Won", foldedByDefault: true },
]

function card(id: string, stage: Stage, amountSatang: number | null): KanbanCard<Stage> {
  return { id, stage, title: id, href: `/x/${id}`, amountSatang, client: null, owner: null, due: null }
}

const cards = [
  card("a", "lead", 150_000),
  card("b", "proposal", 2_500_050),
  card("c", "lead", null),
  card("d", "lead", 99),
]

function summary(list: readonly KanbanCard<Stage>[]) {
  return groupCards(columns, list).map((g) => ({
    id: g.id,
    ids: g.cards.map((c) => c.id),
    sum: g.sumSatang,
  }))
}

describe("groupCards", () => {
  it("buckets cards by stage in column order with counts and satang sums", () => {
    expect(summary(cards)).toEqual([
      { id: "lead", ids: ["a", "c", "d"], sum: 150_099 },
      { id: "proposal", ids: ["b"], sum: 2_500_050 },
      { id: "won", ids: [], sum: 0 },
    ])
  })

  it("keeps column metadata and drops cards whose stage has no column", () => {
    const groups = groupCards(columns.slice(0, 1), cards)
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({ id: "lead", label: "Lead" })
    expect(groups[0]!.cards).toHaveLength(3)
  })

  it("sums expected revenue per column from each card's probability, null when no card has one", () => {
    const weighted = [
      { ...card("a", "lead", 150_000), probability: 10 },
      { ...card("d", "lead", 333), probability: 50 },
      card("b", "proposal", 2_500_050),
    ]
    expect(groupCards(columns, weighted).map((g) => g.expectedSatang)).toEqual([15_167, null, null])
  })

  it("refuses unsafe satang sums instead of losing precision", () => {
    const huge = [card("x", "won", Number.MAX_SAFE_INTEGER), card("y", "won", 1)]
    expect(() => groupCards(columns, huge)).toThrow()
  })
})

describe("moveCard (optimistic stage move)", () => {
  it("applies the move: card leaves its column, tops the target, and both sums update", () => {
    expect(summary(moveCard(cards, "a", "proposal"))).toEqual([
      { id: "lead", ids: ["c", "d"], sum: 99 },
      { id: "proposal", ids: ["a", "b"], sum: 2_650_050 },
      { id: "won", ids: [], sum: 0 },
    ])
  })

  it("rolls back cleanly: the server list is untouched, so dropping the optimistic layer restores it", () => {
    const before = structuredClone(cards)
    moveCard(cards, "b", "won")
    expect(cards).toEqual(before)
    expect(summary(cards)).toEqual(summary(before))
  })

  it("is a no-op for the current stage or an unknown card", () => {
    expect(moveCard(cards, "a", "lead")).toBe(cards)
    expect(moveCard(cards, "missing", "won")).toBe(cards)
  })

  it("places the card right after the given card, in its own column or another", () => {
    expect(summary(moveCard(cards, "a", "lead", "d"))[0]!.ids).toEqual(["c", "d", "a"])
    expect(summary(moveCard(cards, "d", "lead", "a"))[0]!.ids).toEqual(["a", "d", "c"])
    expect(summary(moveCard(cards, "b", "lead", "c"))[0]!.ids).toEqual(["a", "c", "b", "d"])
  })

  it("is a no-op when the card already sits after the given card", () => {
    expect(moveCard(cards, "c", "lead", "a")).toBe(cards)
  })

  it("falls back to the top of the column when the anchor card is gone", () => {
    expect(summary(moveCard(cards, "d", "lead", "missing"))[0]!.ids).toEqual(["d", "a", "c"])
  })
})

describe("drop position", () => {
  const ids = ["a", "c", "d"]

  it("drops after the hovered card on its lower half, after its predecessor on the upper half", () => {
    expect(afterForDrop(ids, "c", true)).toBe("c")
    expect(afterForDrop(ids, "c", false)).toBe("a")
    expect(afterForDrop(ids, "a", false)).toBeNull()
  })

  it("keeps the dragged card in place when it hovers itself or the slot it already fills", () => {
    const withDragged = ["a", "x", "b"]
    expect(afterForDrop(withDragged, "b", false, "x")).toBe("a")
    expect(afterForDrop(withDragged, "x", true, "x")).toBe("a")
    expect(afterForDrop(withDragged, "b", true, "x")).toBe("b")
    expect(afterForDrop(["x", "a"], "a", false, "x")).toBeNull()
  })

  it("moves one place up or down from the keyboard, undefined at the edges", () => {
    expect(reorderAfter(ids, "d", "up")).toBe("a")
    expect(reorderAfter(ids, "c", "up")).toBeNull()
    expect(reorderAfter(ids, "a", "up")).toBeUndefined()
    expect(reorderAfter(ids, "a", "down")).toBe("c")
    expect(reorderAfter(ids, "d", "down")).toBeUndefined()
  })
})

describe("serialQueue", () => {
  it("runs tasks one after another in call order, even when an earlier one is slower", async () => {
    const enqueue = serialQueue()
    const log: string[] = []
    const slow = enqueue(async () => {
      log.push("start 1")
      await new Promise((r) => setTimeout(r, 20))
      log.push("end 1")
      return 1
    })
    const fast = enqueue(async () => {
      log.push("start 2")
      return 2
    })
    expect(await Promise.all([slow, fast])).toEqual([1, 2])
    expect(log).toEqual(["start 1", "end 1", "start 2"])
  })

  it("keeps going after a task fails, and the failure reaches only its caller", async () => {
    const enqueue = serialQueue()
    const failed = enqueue(() => Promise.reject(new Error("offline")))
    const next = enqueue(async () => "ran")
    await expect(failed).rejects.toThrow("offline")
    await expect(next).resolves.toBe("ran")
  })
})

describe("activity bar", () => {
  const today = "2026-10-23"
  const dated = [
    { ...card("a", "lead", null), due: "2026-10-20" },
    { ...card("c", "lead", null), due: today },
    { ...card("d", "lead", null), due: "2026-11-01" },
    { ...card("e", "lead", null), due: "2026-10-01" },
    card("f", "lead", null),
  ]

  it("counts cards by next-activity state", () => {
    expect(activityCounts(dated, today)).toEqual({ overdue: 2, today: 1, planned: 1, none: 1 })
  })

  it("gives each card the state its column filter matches", () => {
    expect(dated.filter((c) => activityState(c, today) === "overdue").map((c) => c.id)).toEqual(["a", "e"])
    expect(dated.filter((c) => activityState(c, today) === "none").map((c) => c.id)).toEqual(["f"])
  })
})

describe("hasTypedInput (quick create Escape guard)", () => {
  it("is true only when some field holds non-blank text", () => {
    expect(hasTypedInput([["title", "  "], ["amount", ""]])).toBe(false)
    expect(hasTypedInput([["title", ""], ["amount", "12"]])).toBe(true)
    expect(hasTypedInput([["clientId", "c1"]])).toBe(true)
  })
})

describe("movedCardFocus (keyboard Move to…)", () => {
  const optimistic = moveCard(cards, "a", "proposal")

  it("follows the card into its new column while the move is pending", () => {
    expect(movedCardFocus("a", optimistic, { pending: true, focusLost: true })).toEqual({
      selectors: ['[data-card="a"] [data-move]', '[data-unfold="proposal"]'],
      followId: "a",
    })
  })

  it("refocuses the card back in its old column after a rejected move, then stops following", () => {
    expect(movedCardFocus("a", cards, { pending: false, focusLost: true })).toEqual({
      selectors: ['[data-card="a"] [data-move]', '[data-unfold="lead"]'],
      followId: null,
    })
  })

  it("leaves focus alone when it was kept or moved elsewhere", () => {
    expect(movedCardFocus("a", optimistic, { pending: false, focusLost: false })).toEqual({ selectors: [], followId: null })
    expect(movedCardFocus("a", optimistic, { pending: true, focusLost: false })).toEqual({ selectors: [], followId: "a" })
  })

  it("does nothing without a followed card that still exists", () => {
    expect(movedCardFocus(null, cards, { pending: true, focusLost: true })).toEqual({ selectors: [], followId: null })
    expect(movedCardFocus("missing", cards, { pending: true, focusLost: true })).toEqual({ selectors: [], followId: null })
  })
})

describe("card helpers", () => {
  it("classifies the next activity date against today", () => {
    expect(dueState("2026-10-22", "2026-10-23")).toBe("overdue")
    expect(dueState("2026-10-23", "2026-10-23")).toBe("today")
    expect(dueState("2026-11-01", "2026-10-23")).toBe("planned")
  })

  it("picks the earliest date and ignores nulls", () => {
    expect(earliestDate([null, "2026-11-02", "2026-10-30", null])).toBe("2026-10-30")
    expect(earliestDate([null])).toBeNull()
  })

  it("builds owner initials from first and last names, skipping Thai leading vowels", () => {
    expect(initials("Boom Big Nose")).toBe("BN")
    expect(initials("  ada  ")).toBe("A")
    expect(initials("สมชาย ใจดี")).toBe("สจ")
  })

  it("parses a stored fold list and ignores anything malformed", () => {
    expect(parseFolded('["won","lost"]')).toEqual(["won", "lost"])
    expect(parseFolded(null)).toBeNull()
    expect(parseFolded("{")).toBeNull()
    expect(parseFolded('[1,"won"]')).toBeNull()
    expect(parseFolded('"won"')).toBeNull()
  })
})
