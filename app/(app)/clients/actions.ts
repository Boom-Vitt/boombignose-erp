"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { z } from "zod"

import { createClient as createSupabaseClient } from "@/lib/supabase/server"
import { requireOrgContext, requireCapability } from "@/lib/auth"

const ClientInput = z.object({
  name: z.string().min(1, "Name is required"),
  industry: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
})

const ContactInput = z.object({
  client_id: z.string().uuid(),
  name: z.string().min(1, "Name is required"),
  email: z.string().optional(),
  phone: z.string().optional(),
  role: z.string().optional(),
})

/** Empty/whitespace-only optional string → null (don't store ""). */
function nullify(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function createClient(
  input: z.infer<typeof ClientInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ClientInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { data, error } = await supabase
    .from("clients")
    .insert({
      org_id: ctx.orgId,
      owner: ctx.userId,
      name: parsed.data.name.trim(),
      industry: nullify(parsed.data.industry),
      source: nullify(parsed.data.source),
      notes: nullify(parsed.data.notes),
    })
    .select("id")
    .single()

  if (error) return { error: error.message }

  revalidatePath("/clients")
  redirect(`/clients/${data.id}`)
}

export async function updateClient(
  id: string,
  input: z.infer<typeof ClientInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ClientInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("clients")
    .update({
      name: parsed.data.name.trim(),
      industry: nullify(parsed.data.industry),
      source: nullify(parsed.data.source),
      notes: nullify(parsed.data.notes),
    })
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/clients")
  revalidatePath(`/clients/${id}`)
  return {}
}

export async function deleteClient(id: string): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "client:delete")
  } catch {
    return { error: "Only owners and admins can delete clients." }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("clients")
    .delete()
    .eq("id", id)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath("/clients")
  redirect("/clients")
}

export async function addContact(
  input: z.infer<typeof ContactInput>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  const parsed = ContactInput.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createSupabaseClient()
  const { error } = await supabase.from("contacts").insert({
    org_id: ctx.orgId,
    client_id: parsed.data.client_id,
    name: parsed.data.name.trim(),
    email: nullify(parsed.data.email),
    phone: nullify(parsed.data.phone),
    role: nullify(parsed.data.role),
  })

  if (error) return { error: error.message }

  revalidatePath(`/clients/${parsed.data.client_id}`)
  return {}
}

export async function deleteContact(
  contactId: string,
  clientId: string
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  try {
    requireCapability(ctx, "client:delete")
  } catch {
    return { error: "Only owners and admins can delete contacts." }
  }

  const supabase = await createSupabaseClient()
  const { error } = await supabase
    .from("contacts")
    .delete()
    .eq("id", contactId)
    .eq("org_id", ctx.orgId)

  if (error) return { error: error.message }

  revalidatePath(`/clients/${clientId}`)
  return {}
}
