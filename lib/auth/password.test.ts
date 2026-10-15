import { describe, it, expect, vi } from "vitest"

import { authLinkErrorMessage, EXPIRED_RESET_MESSAGE, isDeadSessionError, validatePassword, PASSWORD_MIN_LENGTH } from "@/lib/auth/password"

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

describe("isDeadSessionError", () => {
  it("recognizes a recovery session that expired or was signed out", () => {
    expect(isDeadSessionError({ name: "AuthSessionMissingError" })).toBe(true)
    expect(isDeadSessionError({ name: "AuthApiError", code: "session_not_found" })).toBe(true)
    expect(isDeadSessionError({ name: "AuthApiError", code: "session_expired" })).toBe(true)
  })

  it("leaves password problems to the form", () => {
    expect(isDeadSessionError({ name: "AuthApiError", code: "same_password" })).toBe(false)
    expect(isDeadSessionError({ name: "AuthWeakPasswordError", code: "weak_password" })).toBe(false)
  })
})

describe("authLinkErrorMessage", () => {
  it("maps known codes to our own wording", () => {
    expect(authLinkErrorMessage("reset_expired")).toBe(EXPIRED_RESET_MESSAGE)
    expect(authLinkErrorMessage("link_invalid")).toMatch(/invalid or has expired/)
  })

  it("never echoes arbitrary query text onto the page", () => {
    expect(authLinkErrorMessage("Account locked, call +66 000 0000")).toBeNull()
    expect(authLinkErrorMessage("toString")).toBeNull()
    expect(authLinkErrorMessage(null)).toBeNull()
  })
})

describe("isDeadSessionError with the real auth client", () => {
  /** An idle recovery session: access token expired, refresh token revoked or reused on the server. */
  async function idleSessionClient(code: string) {
    const { createClient } = await import("@supabase/supabase-js")
    vi.spyOn(console, "error").mockImplementation(() => undefined)
    const session = {
      access_token: "h.e30.s",
      refresh_token: "revoked",
      token_type: "bearer",
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) - 3600,
      user: { id: "user", aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
    }
    const store = new Map([["test-auth", JSON.stringify(session)]])
    return createClient("http://127.0.0.1:55501", "test-key", {
      auth: {
        storageKey: "test-auth",
        storage: { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => void store.set(k, v), removeItem: (k) => void store.delete(k) },
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: async () =>
          Response.json({ code, message: "Invalid Refresh Token" }, { status: 400, headers: { "x-supabase-api-version": "2024-01-01" } }),
      },
    })
  }

  it.each(["refresh_token_not_found", "refresh_token_already_used", "session_expired", "session_not_found"])(
    "treats a password update and factor list on a dead %s session as a dead session",
    async (code) => {
      const supabase = await idleSessionClient(code)
      const { error: updateError } = await supabase.auth.updateUser({ password: "NewPassword123" })
      expect(updateError && isDeadSessionError(updateError)).toBe(true)
      const { error: listError } = await (await idleSessionClient(code)).auth.mfa.listFactors()
      expect(listError && isDeadSessionError(listError)).toBe(true)
    }
  )

  it.each(["refresh_token_not_found", "session_not_found"])(
    "treats authenticator enrollment and verification on a dead %s session as a dead session",
    async (code) => {
      const { error: enrollError } = await (await idleSessionClient(code)).auth.mfa.enroll({ factorType: "totp" })
      expect(enrollError && isDeadSessionError(enrollError)).toBe(true)
      const { error: verifyError } = await (await idleSessionClient(code)).auth.mfa.challengeAndVerify({ factorId: "f", code: "123456" })
      expect(verifyError && isDeadSessionError(verifyError)).toBe(true)
    }
  )
})
