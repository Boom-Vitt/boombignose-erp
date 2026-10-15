import { afterEach, describe, expect, it, vi } from "vitest"

import { deadlineMeta } from "@/app/(app)/projects/_lib/dates"

describe("project deadline labels", () => {
  afterEach(() => vi.useRealTimers())

  it("count days from the Bangkok calendar day while UTC is still on yesterday", () => {
    // 03:00 on 16 Oct in Bangkok is 20:00 on 15 Oct UTC.
    vi.useFakeTimers({ now: new Date("2026-10-15T20:00:00Z") })
    expect(deadlineMeta("2026-10-16")).toMatchObject({ note: "Due today", tone: "warning" })
    expect(deadlineMeta("2026-10-15")).toMatchObject({ note: "1 day overdue", tone: "danger" })
    expect(deadlineMeta("2026-10-17")?.note).toBe("Due tomorrow")
  })

  it("only warns within a week and leaves later deadlines plain", () => {
    vi.useFakeTimers({ now: new Date("2026-10-16T05:00:00Z") })
    expect(deadlineMeta("2026-10-23")).toMatchObject({ note: "In 7 days", tone: "warning" })
    expect(deadlineMeta("2026-10-24")).toMatchObject({ note: null, tone: "default" })
    expect(deadlineMeta(null)).toBeNull()
  })
})
