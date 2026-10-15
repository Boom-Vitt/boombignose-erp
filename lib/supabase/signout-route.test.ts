import { NextRequest } from "next/server"
import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({ signOut: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { signOut: state.signOut } }) }))

import { POST } from "@/app/auth/signout/route"

beforeEach(() => {
  vi.clearAllMocks()
  state.signOut.mockResolvedValue({ error: null })
})

const signOutRequest = () =>
  new NextRequest("https://app.example.test/auth/signout", {
    method: "POST",
    headers: { cookie: "sb-ref-auth-token.0=a; sb-ref-auth-token.1=b; theme=dark" },
  })
const cleared = (res: Response) =>
  res.headers.getSetCookie().filter((c) => c.includes("Expires=Thu, 01 Jan 1970")).map((c) => c.split("=")[0])

it("signs out, sends the browser to sign-in and forgets the workspace choice", async () => {
  const res = await POST(signOutRequest())
  expect(state.signOut).toHaveBeenCalledTimes(1)
  expect(res.status).toBe(303)
  expect(res.headers.get("location")).toBe("https://app.example.test/login")
  expect(cleared(res)).toEqual(["active_org"])
})

it("an unreachable auth server still ends the session in this browser", async () => {
  state.signOut.mockResolvedValueOnce({ error: { name: "AuthRetryableFetchError", message: "fetch failed", status: 0 } })
  const res = await POST(signOutRequest())
  expect(res.headers.get("location")).toBe("https://app.example.test/login")
  // supabase-js keeps its session cookies when the logout request fails, which would leave this browser signed in
  expect(cleared(res).sort()).toEqual(["active_org", "sb-ref-auth-token.0", "sb-ref-auth-token.1"])
})
