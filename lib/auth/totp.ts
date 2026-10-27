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
