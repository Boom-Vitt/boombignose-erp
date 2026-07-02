/**
 * Email sender over Resend's HTTP API using the global `fetch` — NO npm
 * dependency. Mirrors how the AI assist degrades when unconfigured: when
 * RESEND_API_KEY is unset this returns `{ ok: false, reason: "not_configured" }`
 * and NEVER throws or hits the network. All transport errors are caught and
 * returned as `{ ok: false, reason: "error" }` — secrets are never logged.
 *
 * This module has NO `server-only` import so its config/degrade logic stays
 * unit-testable via dependency-injected `fetchImpl`. The API key is read from
 * the server environment at call time and is never prefixed NEXT_PUBLIC_, so it
 * cannot leak into the client bundle.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails"

/** Sensible default from-address; overridable via EMAIL_FROM. */
export const DEFAULT_EMAIL_FROM = "BoomBigNose <onboarding@resend.dev>"

export type SendEmailInput = {
  to: string
  subject: string
  html: string
}

export type SendEmailResult =
  | { ok: true; id?: string }
  | { ok: false; reason: "not_configured" | "error"; error?: string }

export type SendEmailDeps = {
  /** Resend API key. Defaults to RESEND_API_KEY. */
  apiKey?: string
  /** From address. Defaults to EMAIL_FROM or DEFAULT_EMAIL_FROM. */
  from?: string
  /** Injected fetch for tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch
}

/** True only when a Resend API key is present in the server environment. */
export function isEmailConfigured(): boolean {
  return !!process.env.RESEND_API_KEY
}

/**
 * Send one transactional email. Returns a discriminated result and never
 * throws. When unconfigured it degrades gracefully so callers can show a
 * subtle "Email not configured" state.
 */
export async function sendEmail(
  input: SendEmailInput,
  deps: SendEmailDeps = {}
): Promise<SendEmailResult> {
  const apiKey = deps.apiKey ?? process.env.RESEND_API_KEY
  if (!apiKey) {
    // Guard first: no request when the key is missing. Caller degrades.
    return { ok: false, reason: "not_configured" }
  }

  const from = deps.from ?? process.env.EMAIL_FROM ?? DEFAULT_EMAIL_FROM
  const doFetch = deps.fetchImpl ?? fetch

  try {
    const res = await doFetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
      }),
    })

    if (!res.ok) {
      // Read the provider message for context; never include the key.
      let detail = `Email provider returned ${res.status}`
      try {
        const data: unknown = await res.json()
        if (
          data &&
          typeof data === "object" &&
          "message" in data &&
          typeof (data as { message: unknown }).message === "string"
        ) {
          detail = (data as { message: string }).message
        }
      } catch {
        // Non-JSON error body — keep the status-based detail.
      }
      return { ok: false, reason: "error", error: detail }
    }

    let id: string | undefined
    try {
      const data: unknown = await res.json()
      if (
        data &&
        typeof data === "object" &&
        "id" in data &&
        typeof (data as { id: unknown }).id === "string"
      ) {
        id = (data as { id: string }).id
      }
    } catch {
      // Success without a parseable body is still a success.
    }
    return { ok: true, id }
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      error: err instanceof Error ? err.message : "Failed to send email",
    }
  }
}
