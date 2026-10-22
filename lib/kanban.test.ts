import { describe, it, expect } from "vitest"

import {
  dueState,
  earliestDate,
  groupCards,
  initials,
  moveCard,
  parseFolded,
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
