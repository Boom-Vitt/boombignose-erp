import { afterEach, beforeEach, expect, it, vi } from "vitest"
const state = vi.hoisted(() => ({ rpc: vi.fn(), hash: vi.fn(), headers: new Headers() }))
vi.mock("next/headers", () => ({ headers: async () => state.headers }))
vi.mock("next/navigation", () => ({ redirect: (href: string) => { throw new Error(`REDIRECT ${href}`) } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("./server", () => ({ leadAdminClient: () => ({ rpc: state.rpc }), hashLeadIp: state.hash }))
import { submitLead } from "@/app/f/[token]/actions"
const token = "a".repeat(43)
afterEach(() => vi.unstubAllEnvs())
function form(overrides = {}) {
  const data = new FormData()
  for (const [key, value] of Object.entries({ name: "Visitor", email: "visitor@example.invalid", message: "Hello", website: "", ...overrides })) data.set(key, value)
  return data
}
beforeEach(() => {
  vi.resetAllMocks()
  vi.stubEnv("VERCEL", "")
  vi.stubEnv("LEAD_FORM_TRUST_PROXY", "")
  state.headers = new Headers({ "x-forwarded-for": "192.0.2.1" })
  state.hash.mockReturnValue("c".repeat(64))
  state.rpc.mockResolvedValue({ data: "success", error: null })
})

it("rejects invalid fields and the honeypot before touching the database", async () => {
  for (const values of [{ email: "bad" }, { website: "bot" }]) {
    await expect(submitLead(token, form(values))).rejects.toThrow("result=invalid")
  }
  expect(state.rpc).not.toHaveBeenCalled()
})

it("passes only validated fields, a token and hashed IP to the atomic RPC", async () => {
  await expect(submitLead(token, form())).rejects.toThrow("result=success")
  expect(state.hash).toHaveBeenCalledWith("", token)
  expect(state.rpc).toHaveBeenCalledWith("submit_lead_form", {
    p_token: token, p_ip_hash: "c".repeat(64), p_name: "Visitor", p_company: "", p_email: "visitor@example.invalid", p_phone: "", p_message: "Hello", p_website: "",
  })
})

it("uses a forwarded IP only on an explicitly trusted deployment", async () => {
  vi.stubEnv("LEAD_FORM_TRUST_PROXY", "true")
  await expect(submitLead(token, form())).rejects.toThrow("result=success")
  expect(state.hash).toHaveBeenCalledWith("192.0.2.1", token)
})

it("uses the platform IP header on Vercel", async () => {
  vi.stubEnv("VERCEL", "1")
  state.headers.set("x-vercel-forwarded-for", "192.0.2.2")
  await expect(submitLead(token, form())).rejects.toThrow("result=success")
  expect(state.hash).toHaveBeenCalledWith("192.0.2.2", token)
})

it.each(["rate_limited", "unavailable", "invalid"])("shows a friendly %s result", async result => {
  state.rpc.mockResolvedValue({ data: result, error: null })
  await expect(submitLead(token, form())).rejects.toThrow(`result=${result}`)
})

it("does not leak database errors or thrown errors", async () => {
  state.rpc.mockResolvedValue({ data: null, error: { message: "private database detail" } })
  await expect(submitLead(token, form())).rejects.toThrow(`REDIRECT /f/${token}?result=error`)
  state.rpc.mockRejectedValue(new Error("private connection detail"))
  await expect(submitLead(token, form())).rejects.toThrow(`REDIRECT /f/${token}?result=error`)
})
