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
const LOOPBACK_HOST = /^(localhost|127\.0\.0\.1)(:\d+)?$/

/**
 * Next's `request.url` can say `localhost` while the browser is on
 * `127.0.0.1`. Those are different cookie hosts. Stay on the Host the
 * browser sent when it is loopback, and ignore any other Host.
 */
export function loopbackRedirect(path: string, request: Request, fallbackOrigin: string): URL {
  const host = request.headers.get("host") ?? ""
  const origin = LOOPBACK_HOST.test(host) ? `http://${host}` : fallbackOrigin
  return new URL(path, origin)
}

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
