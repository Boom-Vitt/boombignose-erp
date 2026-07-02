import { describe, it, expect, vi } from "vitest"

import { sendEmail } from "@/lib/email/send"

describe("sendEmail", () => {
  it("degrades gracefully when no API key is configured (no network call)", async () => {
    const fetchImpl = vi.fn()
    const res = await sendEmail(
      { to: "a@b.com", subject: "Hi", html: "<p>Hi</p>" },
      { apiKey: undefined, fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(res).toEqual({ ok: false, reason: "not_configured" })
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it("posts to Resend and returns the message id on success", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ id: "msg_123" }), { status: 200 })
    )
    const res = await sendEmail(
      { to: "client@acme.com", subject: "Invoice INV-1", html: "<p>x</p>" },
      { apiKey: "test-key", from: "Me <me@x.com>", fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(res).toEqual({ ok: true, id: "msg_123" })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe("https://api.resend.com/emails")
    expect(init.method).toBe("POST")
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer test-key")
    const body = JSON.parse(init.body as string)
    expect(body).toMatchObject({
      to: "client@acme.com",
      subject: "Invoice INV-1",
      from: "Me <me@x.com>",
    })
  })

  it("returns an error result (never throws) on a non-ok provider response", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ message: "Invalid to address" }), { status: 422 })
    )
    const res = await sendEmail(
      { to: "bad", subject: "s", html: "<p>x</p>" },
      { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(res).toEqual({ ok: false, reason: "error", error: "Invalid to address" })
  })

  it("returns an error result (never throws) when fetch itself rejects", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down")
    })
    const res = await sendEmail(
      { to: "a@b.com", subject: "s", html: "<p>x</p>" },
      { apiKey: "test-key", fetchImpl: fetchImpl as unknown as typeof fetch }
    )
    expect(res).toEqual({ ok: false, reason: "error", error: "network down" })
  })
})
