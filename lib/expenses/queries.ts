import { notFound } from "next/navigation"
import { requireOrgContext } from "@/lib/auth"
import { can } from "@/lib/permissions"
import { createClient } from "@/lib/supabase/server"
import { readAll } from "@/lib/supabase/read-all"
import { claimTotals } from "./flow"

function complete<T>({ data, error }: { data: T[] | null; error: unknown }): T[] {
  if (error || !data) throw new Error("Expense data unavailable. Please reload.")
  return data
}

async function profileNames(db: Awaited<ReturnType<typeof createClient>>, ids: (string | null)[]) {
  const unique = [...new Set(ids.filter((id): id is string => !!id))]
  if (!unique.length) return new Map<string, string>()
  const { data, error } = await db.from("profiles").select("id,full_name").in("id", unique)
  if (error) throw new Error("Expense data unavailable. Please reload.")
  return new Map((data ?? []).map(p => [p.id, p.full_name || "Team member"]))
}

/** The viewer's own claims and, for approvers, other people's claims awaiting a decision or payment. */
export async function expenseClaimLists() {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const claims = () => db.from("expense_claims").select("*").eq("org_id", ctx.orgId)
  const [mine, toApprove, lines] = await Promise.all([
    readAll((from, to) => claims().eq("employee", ctx.userId).order("created_at", { ascending: false }).order("id").range(from, to)).then(complete),
    can(ctx.role, "expense:approve")
      ? readAll((from, to) => claims().in("status", ["submitted", "approved"]).not("employee", "eq", ctx.userId).order("status").order("submitted_at").order("id").range(from, to)).then(complete)
      : null,
    // shortcut: reads every visible line to total the listed claims, like purchasing; move to an SQL aggregate when claim history gets large.
    readAll((from, to) => db.from("expense_lines").select("id,claim_id,amount_satang").eq("org_id", ctx.orgId).order("id").range(from, to)).then(complete),
  ])
  return { mine, toApprove, totals: claimTotals(lines), names: await profileNames(db, (toApprove ?? []).map(claim => claim.employee)) }
}

export async function expenseDetail(id: string) {
  const ctx = await requireOrgContext()
  const db = await createClient()
  const [claim, lines, costs] = await Promise.all([
    db.from("expense_claims").select("*").eq("org_id", ctx.orgId).eq("id", id).maybeSingle(),
    readAll((from, to) => db.from("expense_lines").select("*,projects(name)").eq("org_id", ctx.orgId).eq("claim_id", id).order("position").order("id").range(from, to)).then(complete),
    db.from("costs").select("id", { count: "exact", head: true }).eq("org_id", ctx.orgId).eq("expense_claim_id", id),
  ])
  if (claim.error || costs.error) throw new Error("Expense data unavailable. Please reload.")
  if (!claim.data) notFound()
  const names = await profileNames(db, [claim.data.employee, claim.data.decided_by])
  return { ctx, claim: claim.data, lines, costCount: costs.count ?? 0, names }
}

export async function expenseProjects() {
  const ctx = await requireOrgContext()
  const db = await createClient()
  return complete(await readAll((from, to) => db.from("projects").select("id,name").eq("org_id", ctx.orgId).order("name").order("id").range(from, to)))
}

/** Claims waiting on this viewer's decision; null when the viewer cannot approve. */
export async function expenseApprovalCount(): Promise<number | null> {
  const ctx = await requireOrgContext()
  if (!can(ctx.role, "expense:approve")) return null
  const db = await createClient()
  const { count, error } = await db.from("expense_claims").select("id", { count: "exact", head: true })
    .eq("org_id", ctx.orgId).eq("status", "submitted").not("employee", "eq", ctx.userId)
  if (error) throw new Error("Expense approval count unavailable")
  return count ?? 0
}
