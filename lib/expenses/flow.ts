import type { Role } from "@/lib/auth"
import { sumSatang } from "@/lib/money"
import { can } from "@/lib/permissions"
import { EXPENSE_FLOW, type DocumentFlow, type FlowAction, type FlowCommand } from "@/lib/record/status"
import type { Enums } from "@/lib/types/database"

export type ExpenseStatus = Enums<"expense_status">
type Mover = "claimant" | "approver"
export type ExpenseActor = { userId: string; role: Role }
export type ClaimState = { employee: string; status: ExpenseStatus }

/** Mirrors public.transition_expense_claim: who may move a claim from each status to the next. */
export const EXPENSE_TRANSITIONS: Record<ExpenseStatus, Partial<Record<ExpenseStatus, Mover>>> = {
  draft: { submitted: "claimant" },
  submitted: { approved: "approver", rejected: "approver", draft: "claimant" },
  approved: { rejected: "approver", paid: "approver" },
  rejected: { draft: "claimant" },
  paid: {},
}

export function canTransition(claim: ClaimState, to: ExpenseStatus, actor: ExpenseActor): boolean {
  const mover = EXPENSE_TRANSITIONS[claim.status][to]
  if (mover === "claimant") return claim.employee === actor.userId
  // Nobody decides their own claim, whatever their role.
  return mover === "approver" && claim.employee !== actor.userId && can(actor.role, "expense:approve")
}

const COMMAND_STATUS: Partial<Record<FlowCommand, ExpenseStatus>> = { reject: "rejected" }

/** EXPENSE_FLOW with only the actions this viewer may take on this claim. */
export function claimFlow(claim: ClaimState, actor: ExpenseActor): DocumentFlow<ExpenseStatus> {
  const allowed = (action: FlowAction<ExpenseStatus>) => {
    const to = "to" in action ? action.to : COMMAND_STATUS[action.command]
    return !!to && canTransition(claim, to, actor)
  }
  const { primary, secondary = [] } = EXPENSE_FLOW.next[claim.status]
  return {
    ...EXPENSE_FLOW,
    next: { ...EXPENSE_FLOW.next, [claim.status]: { primary: primary && allowed(primary) ? primary : undefined, secondary: secondary.filter(allowed) } },
  }
}

/** Claim totals keyed by claim id; throws past the safe-integer satang bound. */
export function claimTotals(lines: { claim_id: string; amount_satang: number }[]): Map<string, number> {
  const totals = new Map<string, number>()
  for (const line of lines) totals.set(line.claim_id, sumSatang([totals.get(line.claim_id) ?? 0, line.amount_satang]))
  return totals
}
