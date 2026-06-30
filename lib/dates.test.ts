import { describe, it, expect } from "vitest"

import { todayISO, monthKey, currentMonthKey, isPastDue, daysUntil } from "@/lib/dates"

describe("dates in Asia/Bangkok (UTC+7)", () => {
  it("formats today, rolling over the date at +7", () => {
    // 18:00 UTC -> 01:00 next day in Bangkok
    expect(todayISO(new Date("2026-06-30T18:00:00Z"))).toBe("2026-07-01")
    // 10:00 UTC -> 17:00 same day in Bangkok
    expect(todayISO(new Date("2026-06-30T10:00:00Z"))).toBe("2026-06-30")
  })

  it("computes month key, accounting for the timezone roll-over", () => {
    expect(monthKey("2026-06-30T18:00:00Z")).toBe("2026-07")
    expect(monthKey("2026-06-15T03:00:00Z")).toBe("2026-06")
  })

  it("currentMonthKey agrees with monthKey", () => {
    expect(currentMonthKey(new Date("2026-03-10T05:00:00Z"))).toBe("2026-03")
  })

  it("isPastDue compares ISO date strings", () => {
    expect(isPastDue("2026-06-29", "2026-06-30")).toBe(true)
    expect(isPastDue("2026-06-30", "2026-06-30")).toBe(false)
    expect(isPastDue("2026-07-01", "2026-06-30")).toBe(false)
    expect(isPastDue(null, "2026-06-30")).toBe(false)
  })

  it("daysUntil computes whole-day differences", () => {
    expect(daysUntil("2026-07-05", "2026-06-30")).toBe(5)
    expect(daysUntil("2026-06-29", "2026-06-30")).toBe(-1)
    expect(daysUntil("2026-06-30", "2026-06-30")).toBe(0)
  })
})
