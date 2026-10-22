"use server"

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { requireCapability, requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { writeAudit } from "@/lib/audit"
import { VendorInput } from "@/lib/purchasing/schema"

export async function saveVendor(id: string | null, input: unknown): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "purchase:manage")
  const parsed = VendorInput.safeParse(input)
  if (!parsed.success || (id !== null && !z.guid().safeParse(id).success)) return { error: "Invalid vendor details" }
  const db = await createClient()
  const result = id
    ? await db.from("vendors").update(parsed.data).eq("org_id", ctx.orgId).eq("id", id).select("id").single()
    : await db.from("vendors").insert({ ...parsed.data, org_id: ctx.orgId }).select("id").single()
  if (result.error) return { error: result.error.message }
  await writeAudit(ctx, { entity: "vendor", entityId: result.data.id, action: id ? "updated" : "created", summary: `${id ? "Updated" : "Created"} vendor ${parsed.data.name}` })
  revalidatePath("/vendors")
  revalidatePath(`/vendors/${result.data.id}`)
  redirect(`/vendors/${result.data.id}`)
}
