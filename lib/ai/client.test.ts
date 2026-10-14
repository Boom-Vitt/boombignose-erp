import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

// 24 chars at runtime so the BBN secret scan never sees a quoted literal.
const KEY = "k".repeat(24)

const ok = (content: unknown) =>
  new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200 })

async function load() {
  vi.resetModules() // DEFAULT_MODEL is read from env at import time
  return import("./client")
}

describe("lib/ai/client", () => {
  const fake = vi.fn()

  beforeEach(() => {
    fake.mockReset()
    vi.stubGlobal("fetch", fake)
    vi.stubEnv("OPENROUTER_API_KEY", KEY)
    vi.stubEnv("OPENROUTER_MODEL", "")
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it("posts to OpenRouter chat completions with the default Gemini model", async () => {
    fake.mockResolvedValue(ok("hi"))
    const { generateText } = await load()
    await generateText({ system: "sys", prompt: "usr", maxTokens: 50 })

    const [url, init] = fake.mock.calls[0]
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions")
    expect(init.method).toBe("POST")
    expect(init.headers.Authorization).toBe(`Bearer ${KEY}`)
    expect(JSON.parse(init.body)).toEqual({
      model: "google/gemini-4-argon",
      max_tokens: 50,
      reasoning: { effort: "low" },
      messages: [
        { role: "system", content: "sys" },
        { role: "user", content: "usr" },
      ],
    })
  })

  it("OPENROUTER_MODEL overrides the default model", async () => {
    vi.stubEnv("OPENROUTER_MODEL", "acme/other-model")
    fake.mockResolvedValue(ok("hi"))
    const { generateText, DEFAULT_MODEL } = await load()
    await generateText({ system: "s", prompt: "p" })

    expect(DEFAULT_MODEL).toBe("acme/other-model")
    expect(JSON.parse(fake.mock.calls[0][1].body).model).toBe("acme/other-model")
  })

  it("no key means no request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "")
    const { generateText, isAIConfigured, AINotConfiguredError } = await load()

    expect(isAIConfigured()).toBe(false)
    const run = generateText({ system: "s", prompt: "p" })
    await expect(run).rejects.toBeInstanceOf(AINotConfiguredError)
    await expect(run).rejects.toThrow("OPENROUTER_API_KEY")
    expect(fake).not.toHaveBeenCalled()
  })

  it("errors never contain the API key", async () => {
    const body = { error: { message: `bad key ${KEY} ${"x".repeat(500)}` } }
    fake.mockResolvedValue(new Response(JSON.stringify(body), { status: 401 }))
    const { generateText } = await load()

    const err = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect(err).toBeInstanceOf(Error)
    const msg = (err as Error).message
    expect(msg).toContain("OpenRouter HTTP 401")
    expect(msg).not.toContain(KEY)
    expect(msg.length).toBeLessThan(260)

    fake.mockResolvedValue(new Response("<html>raw gateway page</html>", { status: 502 }))
    const raw = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect((raw as Error).message).toBe("OpenRouter HTTP 502")
  })

  it("returns the trimmed reply text", async () => {
    fake.mockResolvedValue(ok("  hello world \n"))
    const { generateText } = await load()
    expect(await generateText({ system: "s", prompt: "p" })).toBe("hello world")
  })

  it("rejects a blank reply instead of returning it", async () => {
    fake.mockResolvedValue(ok("  \n"))
    const { generateText } = await load()
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow(
      "OpenRouter returned no text",
    )
  })

  it("rejects a 200 carrying an error or finish_reason error", async () => {
    const { generateText } = await load()

    fake.mockResolvedValue(
      new Response(JSON.stringify({ error: { message: `boom ${KEY}` } }), { status: 200 }),
    )
    const top = await generateText({ system: "s", prompt: "p" }).catch((e: Error) => e)
    expect((top as Error).message).toBe("OpenRouter error: boom [redacted]")

    const partial = { choices: [{ finish_reason: "error", message: { content: "half" } }] }
    fake.mockResolvedValue(new Response(JSON.stringify(partial), { status: 200 }))
    await expect(generateText({ system: "s", prompt: "p" })).rejects.toThrow("OpenRouter error")
  })
})
