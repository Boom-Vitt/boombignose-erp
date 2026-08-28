const FALLBACK_PATH = "/dashboard"

/**
 * Keep post-auth redirects inside this application. Query strings are allowed
 * for filtered views, but protocol-relative and absolute URLs are rejected.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = FALLBACK_PATH): string {
  if (!value || !value.startsWith("/") || value.startsWith("//")) {
    return fallback
  }
  return value
}
