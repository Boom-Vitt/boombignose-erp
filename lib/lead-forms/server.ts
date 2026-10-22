import "server-only"
import { createHmac, randomBytes } from "node:crypto"
import { isIP } from "node:net"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createAdminClient } from "@/lib/supabase/admin"
import type { LeadFormsDatabase } from "./database"
import { LeadToken } from "./input"

export function generateLeadToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashLeadIp(ip: string, token: string): string {
  const secret = process.env.LEAD_FORM_IP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error("Lead form IP hashing is not configured")
  return createHmac("sha256", secret).update(`${token}:${isIP(ip) ? ip : "unknown"}`).digest("hex")
}

export function leadAdminClient() {
  return createAdminClient() as SupabaseClient<LeadFormsDatabase>
}

export async function publicLeadForm(token: string) {
  if (!LeadToken.safeParse(token).success) return null
  const { data, error } = await leadAdminClient().from("lead_forms")
    .select("name,success_message").eq("token", token).eq("enabled", true).not("default_owner", "is", null).maybeSingle()
  if (error) throw new Error("Unable to load lead form")
  return data
}
