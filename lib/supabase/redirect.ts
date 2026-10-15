/** Return destinations are client input; keep authentication navigation local. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/dashboard"
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return "/dashboard"
    const target = new URL(value, "https://local.invalid")
    // Dot segments can normalize "/.//evil" into a protocol-relative "//evil".
    if (target.origin !== "https://local.invalid" || target.pathname.startsWith("//")) return "/dashboard"
    if (["/login", "/signup", "/auth"].some((prefix) => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) {
      return "/dashboard"
    }
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/dashboard"
  }
}

/** `path` carrying a sanitized `?redirect=` across auth steps; unchanged when there is none. */
export function withReturnPath(path: string, returnTo: string | null | undefined): string {
  return returnTo ? `${path}?redirect=${encodeURIComponent(safeReturnPath(returnTo))}` : path
}
