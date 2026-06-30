/**
 * Constant-time-ish comparison for webhook secrets. Avoids early-exit on the
 * first differing character (it still reveals length, which is acceptable for a
 * shared secret). Edge-runtime safe — no Node crypto dependency.
 */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i)
  }
  return mismatch === 0
}

/**
 * Validate an inbound webhook's `X-Webhook-Secret` header against the configured
 * secret. Returns false when either value is missing/empty.
 */
export function verifyWebhookSecret(
  provided: string | null | undefined,
  expected: string | null | undefined
): boolean {
  if (!provided || !expected) return false
  return safeEqual(provided, expected)
}
