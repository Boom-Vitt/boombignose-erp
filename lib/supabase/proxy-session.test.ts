import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { updateSession } from "./middleware"

const url = "https://proxy-test.supabase.test"
const kid = "proxy-test-key"
const encode = (value: object | Uint8Array) => Buffer.from(value instanceof Uint8Array ? value : JSON.stringify(value)).toString("base64url")
const ecdsa = { name: "ECDSA", namedCurve: "P-256", hash: "SHA-256" }
let signer: CryptoKeyPair
let calls: string[]

async function sessionCookie(key: CryptoKey) {
  const now = Math.floor(Date.now() / 1000), sub = crypto.randomUUID()
  const unsigned = `${encode({ alg: "ES256", kid, typ: "JWT" })}.${encode({ sub, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: crypto.randomUUID() })}`
  const signature = new Uint8Array(await crypto.subtle.sign(ecdsa, key, new TextEncoder().encode(unsigned)))
  const session = { access_token: `${unsigned}.${encode(signature)}`, refresh_token: "refresh", token_type: "bearer", expires_in: 3600, expires_at: now + 3600, user: { id: sub, aud: "authenticated", role: "authenticated", app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } }
  return `sb-proxy-test-auth-token=base64-${encode(session)}`
}

beforeEach(async () => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url)
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon")
  signer = await crypto.subtle.generateKey(ecdsa, true, ["sign", "verify"]) as CryptoKeyPair
  const jwk = { ...await crypto.subtle.exportKey("jwk", signer.publicKey), kid, alg: "ES256" }
  calls = []
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const target = String(input instanceof Request ? input.url : input)
    calls.push(target)
    return target.endsWith("/.well-known/jwks.json") ? Response.json({ keys: [jwk] }) : Response.json({ msg: "unavailable" }, { status: 500 })
  }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

// Each page view prefetches dozens of routes through the proxy; an auth-server round trip per request exhausted the local auth service.
it("a validly signed session reaches app routes without an auth-server user lookup", async () => {
  const res = await updateSession(new NextRequest("https://app.example.test/deals", { headers: { cookie: await sessionCookie(signer.privateKey) } }))
  expect(res.headers.get("location")).toBeNull()
  expect(calls.filter(call => call.includes("/auth/v1/user"))).toEqual([])
})

it("a session signed by another key is sent to login", async () => {
  const forger = await crypto.subtle.generateKey(ecdsa, true, ["sign"]) as CryptoKeyPair
  const res = await updateSession(new NextRequest("https://app.example.test/deals", { headers: { cookie: await sessionCookie(forger.privateKey) } }))
  expect(res.headers.get("location")).toBe("https://app.example.test/login?redirect=%2Fdeals")
})
