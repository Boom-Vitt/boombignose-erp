import { describe, expect, it } from "vitest"
import { inPeriod, periodRange } from "./periods"

describe("Bangkok periods", () => {
  const now = new Date("2026-12-31T17:01:00Z")
  it("uses the Bangkok year at the UTC boundary", () => {
    expect(periodRange("this_month", now)).toEqual({ start: "2027-01-01", end: "2027-02-01" })
    expect(periodRange("last_month", now)).toEqual({ start: "2026-12-01", end: "2027-01-01" })
    expect(periodRange("this_quarter", now)).toEqual({ start: "2027-01-01", end: "2027-04-01" })
    expect(periodRange("this_year", now)).toEqual({ start: "2027-01-01", end: "2028-01-01" })
  })
  it("handles leap months and quarter rollover", () => {
    expect(periodRange("last_month", new Date("2024-03-15T12:00Z"))).toEqual({ start: "2024-02-01", end: "2024-03-01" })
    expect(periodRange("this_quarter", new Date("2026-11-01T12:00Z"))).toEqual({ start: "2026-10-01", end: "2027-01-01" })
  })
  it("includes local midnight and excludes the next boundary for dates and instants", () => {
    expect(inPeriod("2026-12-31T17:00:00Z", "this_month", now)).toBe(true)
    expect(inPeriod("2026-12-31T16:59:59Z", "this_month", now)).toBe(false)
    expect(inPeriod("2027-02-01", "this_month", now)).toBe(false)
    expect(inPeriod("2027-01-31", "this_month", now)).toBe(true)
  })
})
