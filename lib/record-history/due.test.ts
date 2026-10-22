import { describe, expect, it } from "vitest"
import { todayISO } from "@/lib/dates"
import { activityDueState, DUE_STYLES } from "./due"

describe("activity due state", () => {
  it.each([
    ["2026-10-22", false, "overdue"], ["2026-10-23", false, "today"], ["2026-10-24", false, "future"],
    [null, false, "none"], ["2026-10-22", true, "none"], ["2026-10-23", true, "none"], ["2026-10-24", true, "none"],
  ] as const)("classifies %s with completion %s as %s", (date, done, expected) => {
    expect(activityDueState(date, "2026-10-23", done)).toBe(expected)
  })
  it("uses the Bangkok calendar day at the UTC boundary", () => {
    expect(activityDueState("2026-10-23", todayISO(new Date("2026-10-22T17:00:00Z")))).toBe("today")
    expect(activityDueState("2026-10-23", todayISO(new Date("2026-10-22T16:59:59Z")))).toBe("future")
  })
  it("assigns the requested colors", () => {
    expect(DUE_STYLES.overdue).toContain("text-red-")
    expect(DUE_STYLES.today).toContain("text-orange-")
    expect(DUE_STYLES.future).toContain("text-green-")
  })
})
