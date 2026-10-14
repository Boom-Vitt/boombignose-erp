/**
 * Read only the operator's configured application URL, never request headers or
 * action inputs. Production stays secure unless HTTP targets an exact loopback
 * origin. The literal check also rejects numeric aliases normalized by URL.
 */
export function workspaceCookieIsSecure(
  configuredAppUrl: string | undefined,
  nodeEnvironment: string | undefined,
): boolean {
  if (!configuredAppUrl) return nodeEnvironment === "production"

  try {
    const url = new URL(configuredAppUrl)
    const exactHttpLoopback = /^http:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i
    if (url.protocol === "http:" && exactHttpLoopback.test(configuredAppUrl)) {
      return false
    }
    // Remote HTTP is a configuration error, never an insecure-cookie exception.
    return true
  } catch {
    return nodeEnvironment === "production"
  }
}
