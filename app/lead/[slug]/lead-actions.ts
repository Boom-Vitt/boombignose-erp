"use server"

import { z } from "zod"

import { createAdminClient } from "@/lib/supabase/admin"

/**
 * PUBLIC web-to-lead capture action. There is NO user session here, so it runs
 * on the service-role admin client (RLS is bypassed) and MUST scope every write
 * to the single organization resolved from the public `slug`.
 *
 * Trust boundary: the ONLY thing we trust from the caller is the `slug` and the
 * submitter-provided contact fields. We re-resolve the org ourselves (by slug
 * AND lead_capture_enabled) and never use any org_id/id sent by the caller. A
 * hidden honeypot field must stay empty; a filled honeypot silently succeeds
 * without writing anything, to deter bots. No secrets are logged or returned.
 */

const LeadInput = z.object({
  slug: z.string().trim().min(1),
  name: z.string().trim().min(1, "Please enter your name").max(200),
  email: z.string().trim().email("Enter a valid email").max(320),
  phone: z.string().trim().max(50).optional(),
  company: z.string().trim().max(200).optional(),
  message: z.string().trim().max(2000).optional(),
  // Honeypot: real users never see or fill this. Must stay empty.
  honeypot: z.string().optional(),
})

export type LeadInput = z.input<typeof LeadInput>

/** Empty/whitespace-only optional string → null (don't store ""). */
function nullify(value: string | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

export async function submitLead(
  input: LeadInput
): Promise<{ ok?: true; error?: string }> {
  const parsed = LeadInput.safeParse(input)
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const d = parsed.data

  // Bot hit: pretend success without touching any data.
  if (d.honeypot && d.honeypot.trim() !== "") {
    return { ok: true }
  }

  const supabase = createAdminClient()

  // Re-resolve the org by slug AND opt-in. A missing / disabled org resolves to
  // null and we return the same generic message (no existence leak).
  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .select("id")
    .eq("slug", d.slug)
    .eq("lead_capture_enabled", true)
    .maybeSingle()

  if (orgErr || !org) {
    return { error: "This form is not accepting submissions right now." }
  }

  const company = nullify(d.company)
  const message = nullify(d.message)

  // 1) Client named from the submitter (org-scoped; source tags the origin).
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({
      org_id: org.id,
      name: company ?? d.name.trim(),
      source: "web-lead",
    })
    .select("id")
    .single()

  if (clientErr || !client) {
    return { error: "Something went wrong. Please try again." }
  }

  // 2) Contact with the submitter's email/phone.
  const { error: contactErr } = await supabase.from("contacts").insert({
    org_id: org.id,
    client_id: client.id,
    name: d.name.trim(),
    email: d.email.trim(),
    phone: nullify(d.phone),
  })
  if (contactErr) {
    return { error: "Something went wrong. Please try again." }
  }

  // 3) Deal in the 'lead' stage, titled from company/message.
  const title = company
    ? `Lead: ${company}`
    : message
      ? `Lead: ${message.slice(0, 80)}`
      : `Lead: ${d.name.trim()}`

  const { error: dealErr } = await supabase.from("deals").insert({
    org_id: org.id,
    client_id: client.id,
    stage: "lead",
    title,
    source: "web-lead",
    notes: message,
  })
  if (dealErr) {
    return { error: "Something went wrong. Please try again." }
  }

  // Best-effort note on the new client (no user session, so owner is null).
  await supabase.from("activities").insert({
    org_id: org.id,
    client_id: client.id,
    type: "note",
    body: `New web lead from ${d.name.trim()} (${d.email.trim()})`,
  })

  return { ok: true }
}
