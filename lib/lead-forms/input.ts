import { z } from "zod"

export const LeadToken = z.string().regex(/^[A-Za-z0-9_-]{43}$/)
export const LeadInput = z.object({
  name: z.string().trim().min(1).max(120),
  company: z.string().trim().max(200),
  email: z.string().trim().max(254).pipe(z.email()).transform(value => value.toLowerCase()),
  phone: z.string().trim().max(50),
  message: z.string().trim().min(1).max(4000),
  website: z.literal(""),
})
export const LeadFormInput = z.object({
  name: z.string().trim().min(1).max(120),
  defaultOwner: z.guid(),
  successMessage: z.string().trim().min(1).max(500),
})

export const LEAD_IP_LIMIT = 5
export const LEAD_FORM_LIMIT = 50

export function leadRateLimited(counts: { form: number; ip: number }): boolean {
  return counts.form >= LEAD_FORM_LIMIT || counts.ip >= LEAD_IP_LIMIT
}

export const LEAD_ERRORS = {
  invalid: "Please enter your name, a valid email, and a message of up to 4,000 characters. Leave the website field empty.",
  unavailable: "This form is unavailable. Please contact the team directly.",
  rate_limited: "Too many requests. Please wait 10 minutes and try again.",
  error: "We could not send your message. Please try again later.",
} as const
