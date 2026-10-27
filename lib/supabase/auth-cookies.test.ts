import { expect, it } from "vitest"

import { authCookieNames, supabaseStorageKey } from "./auth-cookies"

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
