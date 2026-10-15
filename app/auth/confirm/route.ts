import { type EmailOtpType } from "@supabase/supabase-js"
import { NextResponse, type NextRequest } from "next/server"

import { createClient } from "@/lib/supabase/server"
import type { AuthLinkError } from "@/lib/auth/password"
import { safeReturnPath } from "@/lib/supabase/redirect"

/**
 * Email-confirmation callback for signups (and other email OTP links).
 *
 * Supabase appends one of two shapes to the redirect URL depending on the
 * email template / flow:
 *   - `?token_hash=...&type=signup`  → verify with `verifyOtp`
 *   - `?code=...` (PKCE)             → exchange with `exchangeCodeForSession`
 * We handle both so the local Inbucket default template and a PKCE template
 * both work without editing the template.
 *
 * IMPORTANT: uses the SSR server client so the verified session is written to
 * the response cookies; a plain `@supabase/supabase-js` client would verify but
 * leave the user unauthenticated. On success → the local `next` path (password
 * recovery sends `/reset-password`, default /dashboard), else → /login, or
 * /forgot-password for a dead recovery link so a new one is one click away.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const tokenHash = searchParams.get("token_hash")
  const type = searchParams.get("type") as EmailOtpType | null
  const code = searchParams.get("code")
  const next = safeReturnPath(searchParams.get("next"))

  const supabase = await createClient()

  // PKCE flow: exchange the auth code for a session.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url), {
        status: 303,
      })
    }
    return failureOrExistingSession(request, next, type)
  }

  // OTP flow: verify the email token hash.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    })
    if (!error) {
      return NextResponse.redirect(new URL(next, request.url), {
        status: 303,
      })
    }
    return failureOrExistingSession(request, next, type)
  }

  // Supabase rejected the link before redirecting here (e.g. error_code=otp_expired).
  return failureOrExistingSession(request, next, type)
}

/** Reusing a consumed link must not discard an already authenticated session. */
async function failureOrExistingSession(
  request: NextRequest,
  next: string,
  type: EmailOtpType | null
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) return NextResponse.redirect(new URL(next, request.url), { status: 303 })
  const recovery = type === "recovery" || next === "/reset-password"
  return recovery ? failure(request, "/forgot-password", "reset_expired") : failure(request, "/login", "link_invalid")
}

/** Redirect to an auth page with an error code; the page owns the wording. */
function failure(request: NextRequest, pathname: string, code: AuthLinkError) {
  const url = new URL(pathname, request.url)
  url.searchParams.set("error", code)
  return NextResponse.redirect(url, { status: 303 })
}
