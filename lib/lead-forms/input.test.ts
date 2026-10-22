import { describe, expect, it } from "vitest"
import { LeadFormInput, LeadInput, LeadToken, LEAD_FORM_LIMIT, LEAD_IP_LIMIT, leadRateLimited } from "./input"

const valid = { name: " Visitor ", company: " Example ", email: " PERSON@example.invalid ", phone: " +66 123 ", message: " Please call ", website: "" }

describe("public lead boundary", () => {
  it("normalizes contact details without dropping the message", () => {
    expect(LeadInput.parse(valid)).toEqual({ name: "Visitor", company: "Example", email: "person@example.invalid", phone: "+66 123", message: "Please call", website: "" })
  })
  it.each([
    { name: " " }, { email: "bad" }, { message: " " }, { name: "x".repeat(121) },
    { company: "x".repeat(201) }, { phone: "x".repeat(51) }, { message: "x".repeat(4001) },
    { email: new File(["bad"], "contact.txt") },
  ])("rejects invalid or oversized input %j", override => {
    expect(LeadInput.safeParse({ ...valid, ...override }).success).toBe(false)
  })
  it.each(["https://spam.invalid", " ", "0"])("rejects the honeypot including %j", website => {
    expect(LeadInput.safeParse({ ...valid, website }).success).toBe(false)
  })
  it("permits optional company and phone and bounds tokens and owner settings", () => {
    expect(LeadInput.safeParse({ ...valid, company: "", phone: "" }).success).toBe(true)
    expect(LeadToken.safeParse("a".repeat(43)).success).toBe(true)
    for (const token of ["short", "a".repeat(42), "a".repeat(44), "/".repeat(43)]) expect(LeadToken.safeParse(token).success).toBe(false)
    expect(LeadFormInput.safeParse({ name: "Sales", defaultOwner: "not-a-uuid", successMessage: "Thanks" }).success).toBe(false)
    expect(LeadFormInput.safeParse({ name: "Sales", defaultOwner: "b0000000-0000-0000-0000-000000000001", successMessage: "Thanks" }).success).toBe(true)
  })
  it("allows the last request below both limits and rejects either limit independently", () => {
    expect(leadRateLimited({ form: LEAD_FORM_LIMIT - 1, ip: LEAD_IP_LIMIT - 1 })).toBe(false)
    expect(leadRateLimited({ form: LEAD_FORM_LIMIT, ip: 0 })).toBe(true)
    expect(leadRateLimited({ form: 0, ip: LEAD_IP_LIMIT })).toBe(true)
    expect(leadRateLimited({ form: LEAD_FORM_LIMIT + 1, ip: LEAD_IP_LIMIT + 1 })).toBe(true)
  })
})
