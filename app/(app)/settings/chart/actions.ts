"use server"

import { revalidatePath } from "next/cache"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export async function installThaiSmeChart(): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try { requireCapability(ctx, "settings:manage") }
  catch { return { error: "Only owners and admins can install the chart." } }
  const supabase = await createClient()
  const { error } = await supabase.rpc("install_thai_sme_chart", { p_org_id: ctx.orgId })
  if (error) return { error: error.message }
  revalidatePath("/settings/chart")
  return {}
}
