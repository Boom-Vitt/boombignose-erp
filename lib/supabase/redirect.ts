/** Return destinations are client input; keep authentication navigation local. */
export function safeReturnPath(value: string | null | undefined): string {
  if (!value || !value.startsWith("/")) return "/dashboard"
  try {
    const decoded = decodeURIComponent(value)
    if (decoded.startsWith("//") || /[\\\u0000-\u0020]/.test(decoded)) return "/dashboard"
    const target = new URL(value, "https://local.invalid")
    if (target.origin !== "https://local.invalid") return "/dashboard"
    if (["/login", "/signup", "/auth"].some((prefix) => target.pathname === prefix || target.pathname.startsWith(`${prefix}/`))) {
      return "/dashboard"
    }
    return `${target.pathname}${target.search}${target.hash}`
  } catch {
    return "/dashboard"
  }
}
