import { describe, it, expect } from "vitest"

import { validatePassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password"

describe("validatePassword", () => {
  it("accepts a strong password", () => {
    const result = validatePassword("BoomDemo123!")
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("accepts the minimal valid password (exactly the policy floor)", () => {
    // 10 chars, has lower, upper, digit
    const result = validatePassword("Abcdefgh12")
    expect(result.ok).toBe(true)
    expect(result.issues).toEqual([])
  })

  it("rejects a too-short password and reports the length issue", () => {
    const result = validatePassword("short")
    expect(result.ok).toBe(false)
    expect(
      result.issues.some((i) => i.includes(String(PASSWORD_MIN_LENGTH)))
    ).toBe(true)
  })

  it("rejects 'short' for every failing class (length, uppercase, digit)", () => {
    // "short" is < 10, all-lowercase, no digit. Only lowercase rule passes.
    const result = validatePassword("short")
    expect(result.ok).toBe(false)
    expect(result.issues).toHaveLength(3)
  })

  it("rejects a password missing a lowercase letter", () => {
    const result = validatePassword("ABCDEFGH12")
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => /lowercase/i.test(i))).toBe(true)
  })

  it("rejects a password missing an uppercase letter", () => {
    const result = validatePassword("abcdefgh12")
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => /uppercase/i.test(i))).toBe(true)
  })

  it("rejects a password missing a digit", () => {
    const result = validatePassword("Abcdefghij")
    expect(result.ok).toBe(false)
    expect(result.issues.some((i) => /number|digit/i.test(i))).toBe(true)
  })

  it("rejects an all-numeric password (length-valid but no letters)", () => {
    const result = validatePassword("1234567890")
    expect(result.ok).toBe(false)
    // Missing lowercase and uppercase at minimum.
    expect(result.issues.some((i) => /lowercase/i.test(i))).toBe(true)
    expect(result.issues.some((i) => /uppercase/i.test(i))).toBe(true)
  })

  it("rejects an empty password with multiple issues", () => {
    const result = validatePassword("")
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it("treats a non-string input defensively as invalid", () => {
    // @ts-expect-error intentionally passing a non-string to test runtime guard
    const result = validatePassword(undefined)
    expect(result.ok).toBe(false)
    expect(result.issues.length).toBeGreaterThan(0)
  })

  it("returns human-readable issue strings", () => {
    const result = validatePassword("x")
    for (const issue of result.issues) {
      expect(typeof issue).toBe("string")
      expect(issue.length).toBeGreaterThan(0)
    }
  })
})
