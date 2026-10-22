"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { revalidatePath } from "next/cache"
import { LeadInput, LeadToken, LEAD_ERRORS } from "@/lib/lead-forms/input"
import { hashLeadIp, leadAdminClient } from "@/lib/lead-forms/server"

export async function submitLead(token: string, form: FormData): Promise<void> {
  if (!LeadToken.safeParse(token).success) redirect("/f/unavailable")
  const parsed = LeadInput.safeParse(Object.fromEntries(
    ["name", "company", "email", "phone", "message", "website"].map(key => [key, form.get(key) ?? ""])
  ))
  if (!parsed.success) redirect(`/f/${token}?result=invalid`)

  let result = "error"
  try {
    const requestHeaders = await headers()
    // Only trust forwarded addresses when the deployment overwrites them at its edge.
    const ip = process.env.VERCEL === "1"
      ? requestHeaders.get("x-vercel-forwarded-for") ?? ""
      : process.env.LEAD_FORM_TRUST_PROXY === "true"
        ? requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
        : ""
    const { data, error } = await leadAdminClient().rpc("submit_lead_form", {
      p_token: token,
      p_ip_hash: hashLeadIp(ip, token),
      p_name: parsed.data.name,
      p_company: parsed.data.company,
      p_email: parsed.data.email,
      p_phone: parsed.data.phone,
      p_message: parsed.data.message,
      p_website: parsed.data.website,
    })
    if (!error && data && (data === "success" || Object.hasOwn(LEAD_ERRORS, data))) result = data
  } catch {
    result = "error"
  }
  if (result === "success") revalidatePath("/deals")
  redirect(`/f/${token}?result=${result}`)
}
