"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"
import type { SupabaseClient } from "@supabase/supabase-js"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"
import type { LeadFormsDatabase } from "@/lib/lead-forms/database"
import { LeadFormInput } from "@/lib/lead-forms/input"
import { generateLeadToken } from "@/lib/lead-forms/server"

export async function createLeadForm(form: FormData): Promise<void> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const parsed = LeadFormInput.safeParse(Object.fromEntries(form))
  if (!parsed.success) redirect("/settings/lead-forms?error=invalid")
  const supabase = await createClient() as SupabaseClient<LeadFormsDatabase>
  const { data: member, error: memberError } = await supabase.from("memberships").select("user_id")
    .eq("org_id", ctx.orgId).eq("user_id", parsed.data.defaultOwner).maybeSingle()
  if (memberError || !member) redirect("/settings/lead-forms?error=invalid")
  const { data, error } = await supabase.from("lead_forms").insert({
    org_id: ctx.orgId, token: generateLeadToken(), name: parsed.data.name,
    default_owner: parsed.data.defaultOwner, success_message: parsed.data.successMessage,
  }).select("id").single()
  if (error || !data) redirect("/settings/lead-forms?error=save")
  await writeAudit(ctx, { entity: "lead_form", entityId: data.id, action: "created", summary: "Created a lead capture form" })
  revalidatePath("/settings/lead-forms")
  redirect("/settings/lead-forms")
}

export async function disableLeadForm(form: FormData): Promise<void> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const parsed = z.uuid().safeParse(form.get("id"))
  if (!parsed.success) redirect("/settings/lead-forms?error=invalid")
  const supabase = await createClient() as SupabaseClient<LeadFormsDatabase>
  const { data, error } = await supabase.from("lead_forms").update({ enabled: false })
    .eq("id", parsed.data).eq("org_id", ctx.orgId).eq("enabled", true).select("id").maybeSingle()
  if (error) redirect("/settings/lead-forms?error=save")
  if (data) await writeAudit(ctx, { entity: "lead_form", entityId: data.id, action: "disabled", summary: "Disabled a lead capture form" })
  revalidatePath("/settings/lead-forms")
  redirect("/settings/lead-forms")
}
