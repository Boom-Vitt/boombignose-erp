"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { requireCapability, requireOrgContext } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"
import { createClient } from "@/lib/supabase/server"

const PAGE = "/deals/lost-reasons"
const Name = z.string().trim().min(1).max(80)
const Toggle = z.object({ id: z.guid(), active: z.enum(["true", "false"]) })

export async function addLostReason(form: FormData): Promise<void> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const name = Name.safeParse(form.get("name"))
  if (!name.success) redirect(`${PAGE}?error=invalid`)
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("deal_lost_reasons")
    .insert({ org_id: ctx.orgId, name: name.data })
    .select("id")
    .single()
  if (error) redirect(`${PAGE}?error=${error.code === "23505" ? "duplicate" : "save"}`)
  await writeAudit(ctx, { entity: "deal_lost_reason", entityId: data.id, action: "created", summary: `Added lost reason "${name.data}"` })
  revalidatePath(PAGE)
  redirect(PAGE)
}

/** Archive or restore; reasons are never deleted so lost deals keep theirs. */
export async function setLostReasonActive(form: FormData): Promise<void> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "settings:manage")
  const parsed = Toggle.safeParse(Object.fromEntries(form))
  if (!parsed.success) redirect(`${PAGE}?error=invalid`)
  const active = parsed.data.active === "true"
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("deal_lost_reasons")
    .update({ active })
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .select("id,name")
    .maybeSingle()
  if (error || !data) redirect(`${PAGE}?error=save`)
  await writeAudit(ctx, {
    entity: "deal_lost_reason",
    entityId: data.id,
    action: active ? "restored" : "archived",
    summary: `${active ? "Restored" : "Archived"} lost reason "${data.name}"`,
  })
  revalidatePath(PAGE)
  redirect(PAGE)
}
