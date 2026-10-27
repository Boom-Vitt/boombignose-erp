import { describe, expect, it } from "vitest"

import { sessionNeedsStepUp, stepUpPath, totpEnrollEnabled } from "@/lib/auth/totp"

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
  it("stays open when the account has no verified factor", () => {
    expect(
      sessionNeedsStepUp({
        hasVerifiedTotp: false,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe(false)
    expect(
      stepUpPath({
        hasVerifiedTotp: false,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe("")
  })

  it("sends an enrolled aal1 session to the authenticator challenge", () => {
    expect(
      sessionNeedsStepUp({
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe(true)
    expect(
      stepUpPath({
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe("/login/mfa")
  })

  it("leaves an enrolled aal2 session on the app", () => {
    expect(
      sessionNeedsStepUp({
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal2",
      })
    ).toBe(false)
    expect(
      stepUpPath({
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal2",
      })
    ).toBe("")
  })

  it("does not consult the enrollment flag", () => {
    expect(
      sessionNeedsStepUp({
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: null,
      })
    ).toBe(true)
    expect(totpEnrollEnabled(undefined)).toBe(false)
  })
})
