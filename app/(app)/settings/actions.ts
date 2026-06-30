"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { requireOrgContext, requireRole } from "@/lib/auth"
import { bahtToSatang } from "@/lib/money"

const UpdateOrgSettings = z.object({
  orgName: z.string().min(1, "Workspace name is required"),
  cashBalanceBaht: z.coerce.number().min(0, "Cannot be negative"),
  // Optional monthly burn override. Empty / undefined clears the override
  // (dashboard then falls back to the trailing actual burn).
  monthlyBurnBaht: z.coerce.number().min(0, "Cannot be negative").optional(),
})

export type UpdateOrgSettingsInput = z.infer<typeof UpdateOrgSettings>

export async function updateOrgSettings(
  input: UpdateOrgSettingsInput
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()

  // Only owners/admins may change financials and the workspace name.
  try {
    requireRole(ctx, ["owner", "admin"])
  } catch {
    return { error: "Only an owner or admin can update settings." }
  }

  const parsed = UpdateOrgSettings.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { orgName, cashBalanceBaht, monthlyBurnBaht } = parsed.data

  const supabase = await createClient()

  // Upsert the single org_settings row (org_id is unique).
  const { error: settingsError } = await supabase.from("org_settings").upsert(
    {
      org_id: ctx.orgId,
      cash_balance_satang: bahtToSatang(cashBalanceBaht),
      monthly_burn_satang:
        monthlyBurnBaht === undefined || Number.isNaN(monthlyBurnBaht)
          ? null
          : bahtToSatang(monthlyBurnBaht),
    },
    { onConflict: "org_id" }
  )
  if (settingsError) return { error: settingsError.message }

  const { error: orgError } = await supabase
    .from("organizations")
    .update({ name: orgName })
    .eq("id", ctx.orgId)
  if (orgError) return { error: orgError.message }

  revalidatePath("/settings")
  revalidatePath("/dashboard")
  return {}
}
