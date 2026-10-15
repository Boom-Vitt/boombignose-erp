"use server"

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { validatePassword } from "@/lib/auth/password"
import { withReturnPath } from "@/lib/supabase/redirect"

const SignupSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
})

export type SignupResult =
  | { ok: true; requiresConfirmation: boolean }
  | { ok: false; error: string }

/**
 * Real (non-demo) signup. Never trusts client input: validates the email with
 * Zod and the password against the shared policy before touching Supabase.
 * Email confirmation is off: a session is returned immediately and the user is
 * sent to /setup-2fa to enroll an authenticator app (TOTP). With confirmation
 * on, the emailed link leads to the same step, keeping `returnTo` (an invitation).
 */
export async function signUp(input: {
  email: string
  password: string
  returnTo?: string | null
}): Promise<SignupResult> {
  const parsed = SignupSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input." }
  }

  const { email, password } = parsed.data

  const policy = validatePassword(password)
  if (!policy.ok) {
    return { ok: false, error: policy.issues.join(" ") }
  }

  const supabase = await createClient()

  const appUrl = process.env.NEXT_PUBLIC_APP_URL
  const next = encodeURIComponent(withReturnPath("/setup-2fa", input.returnTo))
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      // Unset in some local setups: let Supabase use its Site URL rather than "undefined/auth/confirm".
      emailRedirectTo: appUrl ? `${appUrl}/auth/confirm?next=${next}` : undefined,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true, requiresConfirmation: !data.session }
}
