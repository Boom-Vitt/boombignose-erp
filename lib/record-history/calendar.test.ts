import { expect, it, vi } from "vitest"
import { pageContent } from "@/lib/supabase/__tests__/tenant-fixture"
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "A" }) }))
vi.mock("@/lib/dates", () => ({ todayISO: () => "2026-10-23", currentMonthKey: () => "2026-10" }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({
  from(table: string) {
    const query = {
      select: () => query, eq: () => query, not: () => query, gte: () => query, lte: () => query,
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({ data: table === "activities" ? [
        { id: "overdue", type: "call", due_date: "2026-10-22", done: false, clients: { name: "Buyer" } },
        { id: "today", type: "call", due_date: "2026-10-23", done: false, clients: { name: "Buyer" } },
        { id: "future", type: "call", due_date: "2026-10-24", done: false, clients: { name: "Buyer" } },
        { id: "done", type: "call", due_date: "2026-10-22", done: true, clients: { name: "Buyer" } },
      ] : [], error: null }).then(resolve),
    }
    return query
  },
}) }))
import CalendarPage from "@/app/(app)/calendar/page"
it("puts completion and due state in visible calendar chip text", async () => {
  const content = pageContent(await CalendarPage({ searchParams: Promise.resolve({ month: "2026-10" }) }))
  expect(content).toContain("Completed · Call · Buyer")
  expect(content).toContain("Pending · Overdue · Call · Buyer")
  expect(content).toContain("Pending · Today · Call · Buyer")
  expect(content).toContain("Pending · Future · Call · Buyer")
})
