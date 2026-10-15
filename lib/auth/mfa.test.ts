import { describe, expect, it } from "vitest"

import { MFA_PATH, mfaPath, needsMfa, normalizeTotpCode, tokenAal, totpErrorMessage } from "@/lib/auth/mfa"

/** Unsigned JWT-shaped token; base64url like Supabase issues. */
function token(payload: object): string {
  const body = btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
  return `header.${body}.signature`
}

const verified = [{ status: "verified" }]

describe("tokenAal", () => {
  it("reads the aal claim", () => {
    expect(tokenAal(token({ aal: "aal1" }))).toBe("aal1")
    expect(tokenAal(token({ aal: "aal2", sub: "ü-user?>" }))).toBe("aal2")
  })

  it.each([undefined, null, "", "not-a-jwt", "a.%%%.c", token({})])("returns null for %s", (value) => {
    expect(tokenAal(value)).toBeNull()
  })
})

describe("needsMfa", () => {
  it("requires the challenge for a verified factor on a password-only session", () => {
    expect(needsMfa(verified, token({ aal: "aal1" }))).toBe(true)
  })

  it("treats a missing or unreadable token as not yet verified", () => {
    expect(needsMfa(verified, undefined)).toBe(true)
    expect(needsMfa(verified, "garbage")).toBe(true)
  })

  it("passes once the session reached aal2", () => {
    expect(needsMfa(verified, token({ aal: "aal2" }))).toBe(false)
  })

  it("ignores users without a verified factor", () => {
    expect(needsMfa(undefined, token({ aal: "aal1" }))).toBe(false)
    expect(needsMfa([], token({ aal: "aal1" }))).toBe(false)
    expect(needsMfa([{ status: "unverified" }], token({ aal: "aal1" }))).toBe(false)
  })
})

describe("needsMfa with a malformed aal claim", () => {
  it.each([["aal2"], { level: "aal2" }, 2, "AAL2"])("keeps the challenge for aal %j", (aal) => {
    expect(needsMfa(verified, token({ aal }))).toBe(true)
  })
})

describe("mfaPath", () => {
  it("carries the encoded return destination", () => {
    expect(mfaPath("/invite/abc?x=1")).toBe(`${MFA_PATH}?redirect=%2Finvite%2Fabc%3Fx%3D1`)
  })
})

describe("normalizeTotpCode", () => {
  it("keeps six digits from pasted codes", () => {
    expect(normalizeTotpCode("123 456")).toBe("123456")
    expect(normalizeTotpCode(" 12-34-56-78 ")).toBe("123456")
    expect(normalizeTotpCode("abc")).toBe("")
  })
})

describe("totpErrorMessage", () => {
  it("explains a wrong code", () => {
    expect(totpErrorMessage({ code: "mfa_verification_failed", status: 422, message: "Invalid TOTP code entered" })).toMatch(
      /didn't match/
    )
  })

  it("explains an expired challenge and rate limiting", () => {
    expect(totpErrorMessage({ code: "mfa_challenge_expired", message: "x" })).toMatch(/timed out/)
    expect(totpErrorMessage({ status: 429, message: "x" })).toMatch(/Too many attempts/)
  })

  it("falls back to the original message", () => {
    expect(totpErrorMessage({ message: "Network down" })).toBe("Network down")
  })
})
