import { describe, expect, it } from "vitest"

import { sessionNeedsStepUp, totpEnrollEnabled } from "@/lib/auth/totp"

describe("totpEnrollEnabled", () => {
  it("opens only for the exact flag value", () => {
    expect(totpEnrollEnabled("1")).toBe(true)
    expect(totpEnrollEnabled(undefined)).toBe(false)
    expect(totpEnrollEnabled("")).toBe(false)
    expect(totpEnrollEnabled("true")).toBe(false)
    expect(totpEnrollEnabled("0")).toBe(false)
  })
})

describe("sessionNeedsStepUp", () => {
  it("stays open when the flag is off, even if a factor exists", () => {
    expect(
      sessionNeedsStepUp({
        enrollEnabled: false,
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe(false)
  })

  it("stays open when the account has no verified factor", () => {
    expect(
      sessionNeedsStepUp({
        enrollEnabled: true,
        hasVerifiedTotp: false,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe(false)
  })

  it("asks for a step-up only after a verified factor and an aal1 session", () => {
    expect(
      sessionNeedsStepUp({
        enrollEnabled: true,
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe(true)
    expect(
      sessionNeedsStepUp({
        enrollEnabled: true,
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal2",
      })
    ).toBe(false)
  })
})
