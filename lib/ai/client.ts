// SERVER-ONLY. Importing this from a Client Component (or a vitest node test)
// throws — that guard keeps the API key out of the browser bundle and off the
// test path. The pure prompt/parse modules deliberately do NOT import this
// file, so they stay unit-testable with no key and no network.
import "server-only"

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions"

/** Default model (Gemini 4 via OpenRouter). Override with OPENROUTER_MODEL. */
export const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "google/gemini-4-argon"

/**
 * Thrown when no OPENROUTER_API_KEY is configured. Callers catch this and return
 * a friendly `{ notConfigured: true }` result instead of surfacing an error —
 * the app must never crash or hit the network when the key is absent.
 */
export class AINotConfiguredError extends Error {
  constructor() {
    super("AI is not configured — OPENROUTER_API_KEY is not set.")
    this.name = "AINotConfiguredError"
  }
}

/** True only when an API key is present in the server environment. */
export function isAIConfigured(): boolean {
  return !!process.env.OPENROUTER_API_KEY
}

/**
 * Run a single-shot text generation. Throws AINotConfiguredError BEFORE any
 * request is made when the key is missing. Errors are short and never carry
 * the key or a raw response body.
 */
export async function generateText({
  system,
  prompt,
  maxTokens = 1024,
}: {
  system: string
  prompt: string
  maxTokens?: number
}): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY
  if (!key) throw new AINotConfiguredError()

  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      "X-Title": "BigNose OS",
    },
    body: JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: maxTokens,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(60_000),
  })

  // Parse defensively: the body may be non-JSON (gateway error page).
  const data = (await res.json().catch(() => null)) as {
    choices?: { message?: { content?: unknown } }[]
    error?: { message?: unknown }
  } | null

  if (!res.ok) {
    const msg = typeof data?.error?.message === "string" ? data.error.message : ""
    // Redact the key in case an upstream error echoes it back.
    const safe = msg.split(key).join("[redacted]").slice(0, 200)
    throw new Error(`OpenRouter HTTP ${res.status}${safe ? `: ${safe}` : ""}`)
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== "string") throw new Error("OpenRouter returned no text")
  return content.trim()
}
