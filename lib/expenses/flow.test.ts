import { describe, expect, it } from "vitest"

import { EXPENSE_FLOW, statusBar } from "@/lib/record/status"
import { Constants } from "@/lib/types/database"
import { canTransition, claimFlow, claimTotals, EXPENSE_TRANSITIONS, type ExpenseActor, type ExpenseStatus } from "./flow"
import { ExpenseLineInput } from "./schema"

const STATUSES = Constants.public.Enums.expense_status
const claimant: ExpenseActor = { userId: "claimant", role: "member" }
const teammate: ExpenseActor = { userId: "teammate", role: "member" }
const admin: ExpenseActor = { userId: "admin", role: "admin" }
const owner: ExpenseActor = { userId: "owner", role: "owner" }
const ownersClaim = (status: ExpenseStatus) => ({ employee: "owner", status })
const membersClaim = (status: ExpenseStatus) => ({ employee: "claimant", status })

function labels(flow: ReturnType<typeof claimFlow>, status: ExpenseStatus) {
  const bar = statusBar(flow, status)
  return [bar.primary, ...bar.secondary].filter(Boolean).map(action => action!.label)
}

describe("expense transition table", () => {
  it("plans every status", () => {
    expect(Object.keys(EXPENSE_TRANSITIONS).sort()).toEqual([...STATUSES].sort())
  })

  it("allows exactly the SQL command's moves for the right person", () => {
    const allowed: string[] = []
    for (const from of STATUSES) for (const to of STATUSES) for (const actor of [claimant, teammate, admin, owner]) {
      if (canTransition(membersClaim(from), to, actor)) allowed.push(`${from}>${to}:${actor.userId}`)
    }
    expect(allowed.sort()).toEqual([
      "approved>paid:admin", "approved>paid:owner", "approved>rejected:admin", "approved>rejected:owner",
      "draft>submitted:claimant", "rejected>draft:claimant",
      "submitted>approved:admin", "submitted>approved:owner", "submitted>draft:claimant", "submitted>rejected:admin", "submitted>rejected:owner",
    ])
  })

  it("never lets an approver decide their own claim", () => {
    for (const to of ["approved", "rejected", "paid"] as const) {
      const from = to === "paid" ? "approved" : "submitted"
      expect(canTransition(ownersClaim(from), to, owner)).toBe(false)
      expect(canTransition(ownersClaim(from), to, admin)).toBe(true)
    }
  })

  it("only offers flow actions the table allows", () => {
    for (const status of STATUSES) {
      const { primary, secondary = [] } = EXPENSE_FLOW.next[status]
      for (const action of [primary, ...secondary].filter(Boolean)) {
        const to = "to" in action! ? action.to : "rejected"
        expect(EXPENSE_TRANSITIONS[status][to], `${status} -> ${to}`).toBeDefined()
      }
    }
  })
})

describe("claimFlow", () => {
  it("shows the claimant submit, withdraw and reopen, never decisions", () => {
    expect(labels(claimFlow(membersClaim("draft"), claimant), "draft")).toEqual(["Submit"])
    expect(labels(claimFlow(membersClaim("submitted"), claimant), "submitted")).toEqual(["Withdraw"])
    expect(labels(claimFlow(membersClaim("rejected"), claimant), "rejected")).toEqual(["Reopen"])
  })

  it("shows approvers the decision on someone else's claim", () => {
    expect(labels(claimFlow(membersClaim("submitted"), admin), "submitted")).toEqual(["Approve", "Reject"])
    expect(labels(claimFlow(membersClaim("approved"), owner), "approved")).toEqual(["Mark paid", "Reject"])
    expect(labels(claimFlow(membersClaim("draft"), owner), "draft")).toEqual([])
  })

  it("leaves an approver only the claimant's moves on their own claim", () => {
    expect(labels(claimFlow(ownersClaim("submitted"), owner), "submitted")).toEqual(["Withdraw"])
    expect(labels(claimFlow(ownersClaim("approved"), owner), "approved")).toEqual([])
  })
})

describe("claimTotals", () => {
  it("sums satang per claim", () => {
    const totals = claimTotals([
      { claim_id: "a", amount_satang: 25050 },
      { claim_id: "b", amount_satang: 1 },
      { claim_id: "a", amount_satang: 49900 },
    ])
    expect(Object.fromEntries(totals)).toEqual({ a: 74950, b: 1 })
  })

  it("is empty without lines", () => {
    expect(claimTotals([]).size).toBe(0)
  })

  it("refuses a total past the safe satang bound", () => {
    expect(() => claimTotals([
      { claim_id: "a", amount_satang: Number.MAX_SAFE_INTEGER },
      { claim_id: "a", amount_satang: 1 },
    ])).toThrow()
  })
})

describe("ExpenseLineInput", () => {
  const line = { claim_id: "7f1c2a4e-1b2c-4d3e-8f90-123456789abc", spent_on: "2026-10-20", category: "other", description: " Taxi ", amountBaht: "250.50", project_id: "" }

  it("parses baht into satang and an empty project into null", () => {
    expect(ExpenseLineInput.parse(line)).toEqual({ claim_id: line.claim_id, spent_on: "2026-10-20", category: "other", description: "Taxi", amount_satang: 25050, project_id: null })
  })

  it("accepts seeded ids that are not RFC 4122 versions", () => {
    expect(ExpenseLineInput.safeParse({ ...line, project_id: "e0000000-0000-0000-0000-000000000001" }).success).toBe(true)
  })

  it.each(["0", "0.00", "1.234", "-5", "abc"])("rejects amount %s", amountBaht => {
    expect(ExpenseLineInput.safeParse({ ...line, amountBaht }).success).toBe(false)
  })
})
