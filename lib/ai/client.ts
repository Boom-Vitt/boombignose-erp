// SERVER-ONLY. Importing this from a Client Component (or a vitest node test)
// throws — that guard keeps the SDK and the API key out of the browser bundle
// and off the test path. The pure prompt/parse modules deliberately do NOT
// import this file, so they stay unit-testable with no key and no network.
import "server-only"
import Anthropic from "@anthropic-ai/sdk"

/** Default model. Overridable at runtime via ANTHROPIC_MODEL (see generateText). */
export const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-4-8"

/**
 * Thrown when no ANTHROPIC_API_KEY is configured. Callers catch this and return
 * a friendly `{ notConfigured: true }` result instead of surfacing an error —
 * the app must never crash or hit the network when the key is absent.
 */
export class AINotConfiguredError extends Error {
  constructor() {
    super("AI is not configured — ANTHROPIC_API_KEY is not set.")
    this.name = "AINotConfiguredError"
  }
}

/** True only when an API key is present in the server environment. */
export function isAIConfigured(): boolean {
  return !!process.env.ANTHROPIC_API_KEY
}

/**
 * Run a single-shot text generation. Throws AINotConfiguredError BEFORE any
 * client is constructed or any network call is made when the key is missing.
 * Returns the concatenated text of all text blocks in the response.
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
  if (!isAIConfigured()) {
    // Guard first: no SDK construction, no request. Callers degrade gracefully.
    throw new AINotConfiguredError()
  }

  // Anthropic() reads the key from ANTHROPIC_API_KEY in the environment.
  const client = new Anthropic()

  const message = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  })

  return message.content
    .filter((block): block is Extract<typeof block, { type: "text" }> => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim()
}
