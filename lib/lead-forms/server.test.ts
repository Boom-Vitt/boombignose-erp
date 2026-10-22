import { afterEach, expect, it, vi } from "vitest"
vi.mock("server-only", () => ({}))
import { generateLeadToken, hashLeadIp } from "./server"

afterEach(() => vi.unstubAllEnvs())

it("generates independent tokens with 32 random bytes", () => {
  const tokens = Array.from({ length: 20 }, generateLeadToken)
  expect(new Set(tokens).size).toBe(tokens.length)
  for (const token of tokens) {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(Buffer.from(token, "base64url")).toHaveLength(32)
  }
})

it("hashes addresses with a secret and form scope and fails closed without a secret", () => {
  vi.stubEnv("LEAD_FORM_IP_SECRET", "synthetic-secret")
  const hash = hashLeadIp("192.0.2.1", "form-a")
  expect(hash).toMatch(/^[a-f0-9]{64}$/)
  expect(hashLeadIp("192.0.2.1", "form-a")).toBe(hash)
  expect(hashLeadIp("192.0.2.2", "form-a")).not.toBe(hash)
  expect(hashLeadIp("192.0.2.1", "form-b")).not.toBe(hash)
  expect(hashLeadIp("spoofed", "form-a")).toBe(hashLeadIp("", "form-a"))
  vi.stubEnv("LEAD_FORM_IP_SECRET", "different-synthetic-secret")
  expect(hashLeadIp("192.0.2.1", "form-a")).not.toBe(hash)
  vi.stubEnv("LEAD_FORM_IP_SECRET", "")
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "")
  expect(() => hashLeadIp("192.0.2.1", "form-a")).toThrow("not configured")
})
