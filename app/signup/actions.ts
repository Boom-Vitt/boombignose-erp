"use server"

import { z } from "zod"

import { createClient } from "@/lib/supabase/server"
import { validatePassword } from "@/lib/auth/password"

const SignupSchema = z.object({
  email: z.string().trim().min(1, "Email is required.").email("Enter a valid email address."),
  password: z.string().min(1, "Password is required."),
})

export type SignupResult =
  | { ok: true }
  | { ok: false; error: string }

/**
 * Real (non-demo) signup. Never trusts client input: validates the email with
 * Zod and the password against the shared policy before touching Supabase.
 * On success Supabase sends a confirmation email; the user is created in an
 * unconfirmed state until they click the link, which lands on /auth/confirm.
 */
export async function signUp(input: {
  email: string
  password: string
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
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${appUrl}/auth/confirm`,
    },
  })

  if (error) {
    return { ok: false, error: error.message }
  }

  return { ok: true }
}
