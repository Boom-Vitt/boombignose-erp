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
 * `127.0.0.1`. Those are different cookie hosts. When both are loopback,
 * stay on the Host the browser sent. Otherwise stay on the request URL and
 * ignore a foreign Host header.
 */
export function loopbackRedirect(path: string, request: Request, fallbackOrigin: string): URL {
  let requestUrl: URL | null = null
  try {
    requestUrl = new URL(request.url)
  } catch {
    requestUrl = null
  }
  const host = request.headers.get("host") ?? ""
  if (requestUrl && LOOPBACK_HOST.test(requestUrl.host) && LOOPBACK_HOST.test(host)) {
    return new URL(path, `http://${host}`)
  }
  if (requestUrl && requestUrl.origin !== "null") return new URL(path, requestUrl.origin)
  return new URL(path, fallbackOrigin)
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
