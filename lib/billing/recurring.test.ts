import { describe, it, expect } from "vitest"

import {
  addInterval,
  nextRunAfter,
  isDue,
  dueSubscriptions,
  type SubscriptionLike,
} from "./recurring"

describe("addInterval", () => {
  it("advances weekly", () => {
    expect(addInterval("2026-07-02", "weekly")).toBe("2026-07-09")
  })
  it("advances monthly", () => {
    expect(addInterval("2026-07-02", "monthly")).toBe("2026-08-02")
  })
  it("advances quarterly", () => {
    expect(addInterval("2026-07-02", "quarterly")).toBe("2026-10-02")
  })
  it("advances yearly", () => {
    expect(addInterval("2026-07-02", "yearly")).toBe("2027-07-02")
  })
  it("clamps month-end overflow (Jan 31 → Feb 28)", () => {
    expect(addInterval("2026-01-31", "monthly")).toBe("2026-02-28")
  })
})

describe("nextRunAfter", () => {
  it("advances to the first date strictly after today", () => {
    expect(nextRunAfter("2026-07-02", "monthly", "2026-07-02")).toBe("2026-08-02")
  })
  it("skips over several missed periods", () => {
    // From April, monthly, today July → first future run is August.
    expect(nextRunAfter("2026-04-10", "monthly", "2026-07-15")).toBe("2026-08-10")
  })
  it("leaves a future date untouched", () => {
    expect(nextRunAfter("2026-09-01", "monthly", "2026-07-02")).toBe("2026-09-01")
  })
})

const sub = (over: Partial<SubscriptionLike> = {}): SubscriptionLike => ({
  id: "s1",
  status: "active",
  auto_generate: true,
  next_run_date: "2026-07-01",
  interval: "monthly",
  ...over,
})

describe("isDue", () => {
  it("is due when active, auto, and scheduled on/before today", () => {
    expect(isDue(sub({ next_run_date: "2026-07-02" }), "2026-07-02")).toBe(true)
  })
  it("is not due when scheduled in the future", () => {
    expect(isDue(sub({ next_run_date: "2026-08-01" }), "2026-07-02")).toBe(false)
  })
  it("is not due when paused", () => {
    expect(isDue(sub({ status: "paused" }), "2026-07-02")).toBe(false)
  })
  it("is not due when auto_generate is off", () => {
    expect(isDue(sub({ auto_generate: false }), "2026-07-02")).toBe(false)
  })
})

describe("dueSubscriptions", () => {
  it("returns only the due rows", () => {
    const rows = [
      sub({ id: "a", next_run_date: "2026-07-01" }),
      sub({ id: "b", next_run_date: "2026-08-01" }),
      sub({ id: "c", status: "cancelled", next_run_date: "2026-06-01" }),
    ]
    expect(dueSubscriptions(rows, "2026-07-02").map((s) => s.id)).toEqual(["a"])
  })
})
