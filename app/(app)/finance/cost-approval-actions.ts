"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"

const CostId = z.object({ id: z.string().min(1) })

/**
 * Set a cost's approval status (org-scoped) and stamp who/when. Gated on
 * `settings:manage` (owner/admin). Rejected costs drop out of spend/burn;
 * pending and approved still count. Best-effort audit; revalidates /finance.
 */
async function setApprovalStatus(
  input: z.input<typeof CostId>,
  status: "approved" | "rejected"
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "settings:manage")
  } catch {
    return { error: "Only owners and admins can approve or reject costs." }
  }

  const parsed = CostId.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data: cost, error } = await supabase
    .from("costs")
    .update({
      approval_status: status,
      approved_by: ctx.userId,
      approved_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .select("id, category, amount_satang")
    .single()

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "cost",
    entityId: cost.id,
    action: status === "approved" ? "approved" : "rejected",
    summary: `${status === "approved" ? "Approved" : "Rejected"} ${cost.category} cost`,
    meta: { approvalStatus: status },
  })

  revalidatePath("/finance")
  return {}
}

export async function approveCost(
  input: z.input<typeof CostId>
): Promise<{ error?: string }> {
  return setApprovalStatus(input, "approved")
}

export async function rejectCost(
  input: z.input<typeof CostId>
): Promise<{ error?: string }> {
  return setApprovalStatus(input, "rejected")
}
