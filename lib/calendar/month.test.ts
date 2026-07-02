import { describe, it, expect } from "vitest"

import {
  monthMatrix,
  groupByDate,
  monthLabel,
  formatMonthKey,
  parseMonthKey,
  prevMonth,
  nextMonth,
} from "./month"

describe("monthMatrix", () => {
  it("always returns a 6×7 grid", () => {
    const grid = monthMatrix(2026, 7)
    expect(grid).toHaveLength(6)
    for (const week of grid) expect(week).toHaveLength(7)
  })

  it("starts weeks on Monday", () => {
    // July 2026: the 1st is a Wednesday, so the first Monday cell is June 29.
    const grid = monthMatrix(2026, 7)
    expect(grid[0][0].iso).toBe("2026-06-29")
    expect(grid[0][2].iso).toBe("2026-07-01")
    expect(grid[0][2].inMonth).toBe(true)
  })

  it("flags leading days as out-of-month", () => {
    const grid = monthMatrix(2026, 7)
    expect(grid[0][0].inMonth).toBe(false) // June 29
    expect(grid[0][1].inMonth).toBe(false) // June 30
  })

  it("covers all in-month days exactly once", () => {
    const grid = monthMatrix(2026, 7)
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(31)
    expect(inMonth[0].iso).toBe("2026-07-01")
    expect(inMonth.at(-1)!.iso).toBe("2026-07-31")
  })

  it("handles February in a non-leap year", () => {
    const grid = monthMatrix(2027, 2)
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(28)
    expect(inMonth.at(-1)!.iso).toBe("2027-02-28")
  })

  it("handles February in a leap year", () => {
    const grid = monthMatrix(2028, 2)
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth).toHaveLength(29)
    expect(inMonth.at(-1)!.iso).toBe("2028-02-29")
  })

  it("rolls across a year boundary for December", () => {
    const grid = monthMatrix(2026, 12)
    const inMonth = grid.flat().filter((c) => c.inMonth)
    expect(inMonth[0].iso).toBe("2026-12-01")
    expect(inMonth.at(-1)!.iso).toBe("2026-12-31")
    // Trailing cells spill into January 2027.
    expect(grid.flat().some((c) => c.iso.startsWith("2027-01"))).toBe(true)
  })

  it("produces a strictly sequential run of dates", () => {
    const flat = monthMatrix(2026, 3).flat()
    for (let i = 1; i < flat.length; i++) {
      const prev = Date.parse(`${flat[i - 1].iso}T00:00:00Z`)
      const cur = Date.parse(`${flat[i].iso}T00:00:00Z`)
      expect(cur - prev).toBe(86_400_000)
    }
  })
})

describe("groupByDate", () => {
  it("buckets items by their date field", () => {
    const items = [
      { date: "2026-07-01", id: "a" },
      { date: "2026-07-01", id: "b" },
      { date: "2026-07-02", id: "c" },
    ]
    const grouped = groupByDate(items)
    expect(grouped["2026-07-01"].map((i) => i.id)).toEqual(["a", "b"])
    expect(grouped["2026-07-02"].map((i) => i.id)).toEqual(["c"])
    expect(grouped["2026-07-03"]).toBeUndefined()
  })

  it("returns an empty object for no items", () => {
    expect(groupByDate([])).toEqual({})
  })
})

describe("monthLabel", () => {
  it("formats a readable label", () => {
    expect(monthLabel(2026, 7)).toBe("July 2026")
    expect(monthLabel(2026, 1)).toBe("January 2026")
    expect(monthLabel(2026, 12)).toBe("December 2026")
  })
})

describe("formatMonthKey / parseMonthKey", () => {
  it("round-trips", () => {
    expect(formatMonthKey(2026, 7)).toBe("2026-07")
    expect(parseMonthKey("2026-07")).toEqual({ year: 2026, month: 7 })
  })

  it("rejects invalid keys", () => {
    expect(parseMonthKey(null)).toBeNull()
    expect(parseMonthKey("")).toBeNull()
    expect(parseMonthKey("2026-13")).toBeNull()
    expect(parseMonthKey("2026-00")).toBeNull()
    expect(parseMonthKey("nonsense")).toBeNull()
  })
})

describe("prevMonth / nextMonth", () => {
  it("steps within a year", () => {
    expect(prevMonth({ year: 2026, month: 7 })).toEqual({ year: 2026, month: 6 })
    expect(nextMonth({ year: 2026, month: 7 })).toEqual({ year: 2026, month: 8 })
  })

  it("rolls across year boundaries", () => {
    expect(prevMonth({ year: 2026, month: 1 })).toEqual({ year: 2025, month: 12 })
    expect(nextMonth({ year: 2026, month: 12 })).toEqual({ year: 2027, month: 1 })
  })
})
