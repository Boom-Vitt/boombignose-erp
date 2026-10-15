/**
 * Pure TOTP MFA helpers shared by the proxy guard, the login page and settings.
 *
 * A user with a verified factor must reach assurance level `aal2` (password +
 * TOTP) before using the app; a password-only session is `aal1`.
 */

/** Where a password-only session goes to clear its TOTP challenge. */
export const MFA_PATH = "/login/mfa"

/**
 * Read the `aal` claim from a Supabase access token. Does not verify the
 * signature: callers pass a token Supabase already validated (via getUser).
 */
export function tokenAal(accessToken: string | null | undefined): string | null {
  try {
    const payload = JSON.parse(atob((accessToken ?? "").split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/")))
    return typeof payload.aal === "string" ? payload.aal : null
  } catch {
    return null
  }
}

/**
 * True when the user has a verified factor but the session has not passed it.
 * `factors` must come from a server-verified user, never the session cookie,
 * or a client could strip them to skip the challenge.
 */
export function needsMfa(
  factors: readonly { status: string }[] | null | undefined,
  accessToken: string | null | undefined
): boolean {
  return Boolean(factors?.some((f) => f.status === "verified")) && tokenAal(accessToken) !== "aal2"
}

/** TOTP challenge URL that returns to `returnTo` once verified. */
export function mfaPath(returnTo: string): string {
  return `${MFA_PATH}?redirect=${encodeURIComponent(returnTo)}`
}

/** Digits only, at most 6: authenticator apps show and copy codes with spaces. */
export function normalizeTotpCode(value: string): string {
  return value.replace(/\D/g, "").slice(0, 6)
}
