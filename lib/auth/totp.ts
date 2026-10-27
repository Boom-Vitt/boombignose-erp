/**
 * Local TOTP.
 *
 * LOCAL_TOTP_ENROLL=1 shows the enrollment screen. Any other value keeps that
 * screen closed. sessionNeedsStepUp is separate: an account with a verified
 * factor must reach aal2, and an account with no factor stays on aal1.
 */

export const TOTP_ENROLL_ENV = "LOCAL_TOTP_ENROLL"
export const STEP_UP_PATH = "/login/mfa"

export function totpEnrollEnabled(value: string | undefined): boolean {
  return value === "1"
}

export function sessionNeedsStepUp(input: {
  hasVerifiedTotp: boolean
  authenticatorAssuranceLevel: string | null | undefined
}): boolean {
  if (!input.hasVerifiedTotp) return false
  return input.authenticatorAssuranceLevel !== "aal2"
}

export function stepUpPath(input: {
  hasVerifiedTotp: boolean
  authenticatorAssuranceLevel: string | null | undefined
}): string {
  return sessionNeedsStepUp(input) ? STEP_UP_PATH : ""
}

export type Aal2Rollout = "one-step" | "enroll" | "challenge" | "aal2"

/**
 * Rollout states. The enrollment flag never changes the result for an
 * account that already has a verified factor, and it never asks an account
 * with no factor for a code.
 */
export function aal2Rollout(input: {
  enrollFlag: string | undefined
  hasVerifiedTotp: boolean
  authenticatorAssuranceLevel: string | null | undefined
}): Aal2Rollout {
  if (sessionNeedsStepUp(input)) return "challenge"
  if (input.hasVerifiedTotp) return "aal2"
  return totpEnrollEnabled(input.enrollFlag) ? "enroll" : "one-step"
}

export function aal2RolloutNote(state: Aal2Rollout): string {
  switch (state) {
    case "one-step":
      return "Enrollment is off. This account has no authenticator and stays on one step. Set LOCAL_TOTP_ENROLL=1 and restart the local ERP to open enrollment. Accounts that never enroll are not asked for a code."
    case "enroll":
      return "Enrollment is open for this process. An account stays on one step until a factor is verified. Restart with LOCAL_TOTP_ENROLL unset to close this form. Closing it does not remove a factor that is already verified."
    case "challenge":
      return "This account has a verified authenticator. Enter the code at /login/mfa. Other accounts are not asked."
    case "aal2":
      return "This session is aal2. Turning LOCAL_TOTP_ENROLL off does not remove the authenticator. Accounts that never enrolled stay on one step."
  }
}
