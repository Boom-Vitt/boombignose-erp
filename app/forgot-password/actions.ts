"use server"

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"

const EmailSchema = z.string().trim().email("Enter a valid email address.")

/** Always reports success to avoid revealing whether an account exists. */
export async function requestPasswordReset(emailInput: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = EmailSchema.safeParse(emailInput)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid email." }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  const supabase = await createClient()
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${appUrl}/auth/confirm?next=/reset-password`,
  })

  if (error) return { ok: false, error: "We couldn't send the reset link. Please try again." }
  return { ok: true }
}
