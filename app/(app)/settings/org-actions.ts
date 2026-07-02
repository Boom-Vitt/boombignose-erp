"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { createAdminClient } from "@/lib/supabase/admin"
import { requireOrgContext, requireCapability, ACTIVE_ORG_COOKIE } from "@/lib/auth"
import { writeAudit } from "@/lib/audit"

/**
 * Multi-org + invitations server actions.
 *
 * - Switching the active org sets a cookie that getOrgContext reads.
 * - Inviting/revoking are owner/admin actions scoped to the caller's org (RLS +
 *   requireRole).
 * - ACCEPTING an invitation runs with the service-role admin client: the invitee
 *   is not yet a member, so RLS would hide the invitation row and block the
 *   membership insert (memberships has no authenticated INSERT policy). The token
 *   is validated server-side before any write, and the acting user is taken from
 *   the session — never from client input.
 */

const ONE_YEAR = 60 * 60 * 24 * 365

// ── Switch active org ───────────────────────────────────────────────────────
const SetActiveOrg = z.object({ orgId: z.string().min(1) })

export async function setActiveOrg(
  input: z.input<typeof SetActiveOrg>
): Promise<{ error?: string }> {
  const parsed = SetActiveOrg.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Only switch to an org the user actually belongs to.
  const { data: membership } = await supabase
    .from("memberships")
    .select("org_id")
    .eq("user_id", user.id)
    .eq("org_id", parsed.data.orgId)
    .maybeSingle()
  if (!membership) return { error: "You are not a member of that workspace" }

  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ORG_COOKIE, parsed.data.orgId, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  })

  revalidatePath("/", "layout")
  redirect("/dashboard")
}

// ── Invite a teammate ───────────────────────────────────────────────────────
const InviteMember = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["admin", "member"]).default("member"),
})

export async function inviteMember(
  input: z.input<typeof InviteMember>
): Promise<{ error?: string; token?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "team:manage")

  const parsed = InviteMember.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { email, role } = parsed.data

  const token = crypto.randomUUID().replace(/-/g, "")
  const expiresAt = new Date(Date.now() + 1000 * ONE_YEAR / 12).toISOString() // ~30 days

  const supabase = await createClient()
  // Re-inviting the same email refreshes the row (new token, pending again).
  const { error } = await supabase
    .from("invitations")
    .upsert(
      {
        org_id: ctx.orgId,
        email,
        role,
        token,
        status: "pending",
        invited_by: ctx.userId,
        accepted_by: null,
        expires_at: expiresAt,
      },
      { onConflict: "org_id,email" }
    )

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invitation",
    action: "invited",
    summary: `Invited ${email} as ${role}`,
  })

  revalidatePath("/settings")
  return { token }
}

// ── Revoke a pending invitation ─────────────────────────────────────────────
const RevokeInvitation = z.object({ id: z.string().min(1) })

export async function revokeInvitation(
  input: z.input<typeof RevokeInvitation>
): Promise<{ error?: string }> {
  const ctx = await requireOrgContext()
  requireCapability(ctx, "team:manage")

  const parsed = RevokeInvitation.safeParse(input)
  if (!parsed.success) return { error: "Invalid input" }

  const supabase = await createClient()
  const { error } = await supabase
    .from("invitations")
    .update({ status: "revoked" })
    .eq("id", parsed.data.id)
    .eq("org_id", ctx.orgId)
    .eq("status", "pending")

  if (error) return { error: error.message }

  await writeAudit(ctx, {
    entity: "invitation",
    entityId: parsed.data.id,
    action: "revoked",
    summary: "Revoked a pending invitation",
  })

  revalidatePath("/settings")
  return {}
}

// ── Accept an invitation (invitee side) ─────────────────────────────────────
const AcceptInvitation = z.object({ token: z.string().min(1) })

export async function acceptInvitation(
  input: z.input<typeof AcceptInvitation>
): Promise<{ error?: string }> {
  const parsed = AcceptInvitation.safeParse(input)
  if (!parsed.success) return { error: "Invalid invitation" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect(`/login?redirect=/invite/${parsed.data.token}`)

  // Service-role: the invitee is not yet a member of the org.
  const admin = createAdminClient()
  const { data: invite } = await admin
    .from("invitations")
    .select("id, org_id, email, role, status, expires_at")
    .eq("token", parsed.data.token)
    .maybeSingle()

  if (!invite) return { error: "This invitation link is not valid." }
  if (invite.status !== "pending") {
    return { error: "This invitation is no longer active." }
  }
  if (invite.expires_at && invite.expires_at < new Date().toISOString()) {
    await admin.from("invitations").update({ status: "expired" }).eq("id", invite.id)
    return { error: "This invitation has expired." }
  }
  if (
    user.email &&
    invite.email.toLowerCase() !== user.email.toLowerCase()
  ) {
    return {
      error: `This invitation was sent to ${invite.email}. Sign in with that email to accept.`,
    }
  }

  // Idempotent: create the membership if it doesn't exist yet.
  const { data: existing } = await admin
    .from("memberships")
    .select("id")
    .eq("user_id", user.id)
    .eq("org_id", invite.org_id)
    .maybeSingle()

  if (!existing) {
    const { error: memErr } = await admin.from("memberships").insert({
      org_id: invite.org_id,
      user_id: user.id,
      role: invite.role,
    })
    if (memErr) return { error: memErr.message }
  }

  await admin
    .from("invitations")
    .update({ status: "accepted", accepted_by: user.id })
    .eq("id", invite.id)

  // Make the newly-joined org active.
  const cookieStore = await cookies()
  cookieStore.set(ACTIVE_ORG_COOKIE, invite.org_id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  })

  revalidatePath("/", "layout")
  redirect("/dashboard")
}
