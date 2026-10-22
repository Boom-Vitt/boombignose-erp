"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { ClaimInput, ExpenseLineInput, RejectInput } from "@/lib/expenses/schema"
import type { ExpenseStatus } from "@/lib/expenses/flow"

function refresh(id: string) {
  revalidatePath(`/expenses/${id}`)
  revalidatePath("/expenses")
  revalidatePath("/finance")
  revalidatePath("/dashboard")
}

export async function createExpenseClaim(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ClaimInput.safeParse(input)
  if (!parsed.success) return { error: "Enter a title of up to 200 characters" }
  const db = await createClient()
  const { data, error } = await db.rpc("create_expense_claim", { p_org_id: ctx.orgId, p_title: parsed.data.title })
  if (error) return { error: error.message }
  revalidatePath("/expenses")
  redirect(`/expenses/${data}`)
}

export async function addExpenseLine(input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ExpenseLineInput.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid expense line" }
  const db = await createClient()
  const { data: last, error: readError } = await db.from("expense_lines").select("position").eq("org_id", ctx.orgId).eq("claim_id", parsed.data.claim_id).order("position", { ascending: false }).limit(1)
  if (readError) return { error: readError.message }
  const { error } = await db.from("expense_lines").insert({ ...parsed.data, org_id: ctx.orgId, position: (last?.[0]?.position ?? -1) + 1 })
  if (error) return { error: error.message }
  refresh(parsed.data.claim_id)
  return {}
}

export async function removeExpenseLine(claimId: string, lineId: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  if (!z.guid().safeParse(claimId).success || !z.guid().safeParse(lineId).success) return { error: "Invalid line" }
  const db = await createClient()
  const { data, error } = await db.from("expense_lines").delete().eq("org_id", ctx.orgId).eq("claim_id", claimId).eq("id", lineId).select("id")
  if (error) return { error: error.message }
  if (!data.length) return { error: "Only lines on your draft claims can be removed. Reload to see the latest status." }
  refresh(claimId)
  return {}
}

/** Submit, withdraw and reopen are the claimant's; approve and pay need expense:approve. The SQL command enforces both. */
export async function transitionExpenseClaim(id: string, status: ExpenseStatus): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const target = z.enum(["submitted", "approved", "paid", "draft"]).safeParse(status)
  if (!z.guid().safeParse(id).success || !target.success) return { error: "Invalid expense transition" }
  if (target.data === "approved" || target.data === "paid") requireCapability(ctx, "expense:approve")
  const db = await createClient()
  const { error } = await db.rpc("transition_expense_claim", { p_org_id: ctx.orgId, p_claim_id: id, p_status: target.data })
  if (error) return { error: error.message }
  refresh(id)
  return {}
}

export async function rejectExpenseClaim(id: string, input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "expense:approve")
  const parsed = RejectInput.safeParse(input)
  if (!z.guid().safeParse(id).success || !parsed.success) return { error: "Enter a reason of up to 2,000 characters" }
  const db = await createClient()
  const { error } = await db.rpc("transition_expense_claim", { p_org_id: ctx.orgId, p_claim_id: id, p_status: "rejected", p_note: parsed.data.note })
  if (error) return { error: error.message }
  refresh(id)
  return {}
}
