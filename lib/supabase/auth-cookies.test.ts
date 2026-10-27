import { expect, it } from "vitest"

import { authCookieNames, loopbackRedirect, supabaseStorageKey } from "./auth-cookies"

const key = supabaseStorageKey("http://127.0.0.1:55101")

it("derives the storage key from the API host label", () => {
  expect(key).toBe("sb-127-auth-token")
})

it("collects session chunks, the verifier, and the workspace cookie", () => {
  const header = [
    "sb-127-auth-token.0=aaa",
    "sb-127-auth-token.1=bbb",
    "sb-127-auth-token-code-verifier=ccc",
    "active_org=11111111-1111-1111-1111-111111111111",
    "theme=dark",
  ].join("; ")
  expect(authCookieNames(header, key)).toEqual([
    "sb-127-auth-token.0",
    "sb-127-auth-token.1",
    "sb-127-auth-token-code-verifier",
    "active_org",
  ])
})

it("ignores an empty cookie header", () => {
  expect(authCookieNames("", key)).toEqual([])
})

it("keeps a sign-out redirect on the loopback host the browser used", () => {
  const request = new Request("http://localhost:3101/auth/signout", { headers: { host: "127.0.0.1:3101" } })
  expect(loopbackRedirect("/login", request, "http://127.0.0.1:3100").href).toBe("http://127.0.0.1:3101/login")
})

it("does not follow a non-loopback Host header", () => {
  const request = new Request("http://localhost:3101/auth/signout", { headers: { host: "evil.example" } })
  expect(loopbackRedirect("/login", request, "http://127.0.0.1:3100").href).toBe("http://localhost:3101/login")
})

it("keeps a public confirmation URL when the configured app origin is loopback", () => {
  const request = new Request("https://app.example.test/auth/confirm?token_hash=used&type=signup", {
    headers: { host: "app.example.test" },
  })
  expect(loopbackRedirect("/dashboard", request, "http://127.0.0.1:3100").href).toBe(
    "https://app.example.test/dashboard",
  )
})
