import { describe, it, expect } from "vitest"

import { safeEqual, verifyWebhookSecret } from "@/lib/webhooks/verify"

describe("safeEqual", () => {
  it("is true for equal strings", () => {
    expect(safeEqual("abc", "abc")).toBe(true)
    expect(safeEqual("", "")).toBe(true)
  })

  it("is false for different strings of equal length", () => {
    expect(safeEqual("abc", "abd")).toBe(false)
  })

  it("is false for different lengths", () => {
    expect(safeEqual("abc", "abcd")).toBe(false)
  })
})

describe("verifyWebhookSecret", () => {
  it("accepts a matching secret", () => {
    expect(verifyWebhookSecret("s3cret-value", "s3cret-value")).toBe(true)
  })

  it("rejects a non-matching secret", () => {
    expect(verifyWebhookSecret("nope", "s3cret-value")).toBe(false)
  })

  it("rejects when the provided header is missing or empty", () => {
    expect(verifyWebhookSecret(null, "s3cret")).toBe(false)
    expect(verifyWebhookSecret(undefined, "s3cret")).toBe(false)
    expect(verifyWebhookSecret("", "s3cret")).toBe(false)
  })

  it("rejects when the expected secret is unset", () => {
    expect(verifyWebhookSecret("x", undefined)).toBe(false)
    expect(verifyWebhookSecret("x", "")).toBe(false)
  })
})
