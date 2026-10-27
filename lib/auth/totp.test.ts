import { describe, expect, it } from "vitest"

import {
  aal2Rollout,
  aal2RolloutNote,
  sessionNeedsStepUp,
  stepUpPath,
  totpEnrollEnabled,
} from "@/lib/auth/totp"

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

describe("aal2Rollout", () => {
  it("keeps an account with no factor on one step when enrollment is closed", () => {
    for (const enrollFlag of [undefined, "", "0", "true"]) {
      expect(
        aal2Rollout({
          enrollFlag,
          hasVerifiedTotp: false,
          authenticatorAssuranceLevel: "aal1",
        })
      ).toBe("one-step")
    }
  })

  it("opens enrollment only when the flag is exactly 1 and no factor is verified", () => {
    expect(
      aal2Rollout({
        enrollFlag: "1",
        hasVerifiedTotp: false,
        authenticatorAssuranceLevel: "aal1",
      })
    ).toBe("enroll")
  })

  it("challenges an enrolled account even when enrollment is closed", () => {
    for (const enrollFlag of [undefined, "0", "1"]) {
      expect(
        aal2Rollout({
          enrollFlag,
          hasVerifiedTotp: true,
          authenticatorAssuranceLevel: "aal1",
        })
      ).toBe("challenge")
    }
  })

  it("leaves an enrolled aal2 session in the app when the flag is off", () => {
    expect(
      aal2Rollout({
        enrollFlag: undefined,
        hasVerifiedTotp: true,
        authenticatorAssuranceLevel: "aal2",
      })
    ).toBe("aal2")
  })

  it("does not tell a one-step account to enter a code", () => {
    const note = aal2RolloutNote("one-step")
    expect(note).toContain("one step")
    expect(note).not.toContain("/login/mfa")
    expect(aal2RolloutNote("challenge")).toContain("/login/mfa")
    expect(aal2RolloutNote("aal2")).toContain("never enrolled")
    expect(aal2RolloutNote("enroll")).toContain("LOCAL_TOTP_ENROLL")
  })
})
