/**
 * Local TOTP enrollment gate.
 *
 * LOCAL_TOTP_ENROLL=1 shows the enrollment screen. Any other value keeps the
 * screen closed. This module does not call GoTrue and does not lock an aal1
 * session. sessionNeedsStepUp is the rule a later sign-in check can apply
 * after a factor exists.
 */

export const TOTP_ENROLL_ENV = "LOCAL_TOTP_ENROLL"

export function totpEnrollEnabled(value: string | undefined): boolean {
  return value === "1"
}

export function sessionNeedsStepUp(input: {
  enrollEnabled: boolean
  hasVerifiedTotp: boolean
  authenticatorAssuranceLevel: string | null | undefined
}): boolean {
  if (!input.enrollEnabled || !input.hasVerifiedTotp) return false
  return input.authenticatorAssuranceLevel !== "aal2"
}
