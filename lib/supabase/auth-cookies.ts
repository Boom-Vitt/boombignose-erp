import { ACTIVE_ORG_COOKIE } from "@/lib/auth"

/** Default storage key supabase-js derives from the project URL. */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`
}

/**
 * Cookie names that hold the session, its chunks, the PKCE verifier, or the
 * active workspace. A sign-out that expires only the base name leaves `.0`
 * chunks in place, and the next sign-in is read back as the old session.
 */
export function authCookieNames(cookieHeader: string, storageKey: string): string[] {
  const names: string[] = []
  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf("=")
    const name = eq === -1 ? trimmed : trimmed.slice(0, eq).trim()
    if (!name) continue
    if (name === storageKey || name.startsWith(`${storageKey}.`) || name.startsWith(`${storageKey}-`) || name === ACTIVE_ORG_COOKIE) {
      names.push(name)
    }
  }
  return names
}
