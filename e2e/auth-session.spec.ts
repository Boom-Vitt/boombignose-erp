import { test, expect, type Page } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"

import { demo, loginDemo } from "./auth"

const api = process.env.NEXT_PUBLIC_SUPABASE_URL!
const authCookie = `sb-${new URL(api).hostname.split(".")[0]}-auth-token`
const sessionCookies = async (page: Page) => (await page.context().cookies()).filter(cookie => cookie.name.startsWith(authCookie))
const encode = (text: string) => Buffer.from(text).toString("base64url")

test("a session revoked from another client lands on login with its cookie cleared", async ({ page }) => {
  await loginDemo(page)
  expect(await sessionCookies(page)).not.toEqual([])
  const otherClient = createClient(api, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  expect((await otherClient.auth.signInWithPassword(demo)).error).toBeNull()
  // The default global scope revokes every session of the user, including the browser's unexpired one.
  expect((await otherClient.auth.signOut()).error).toBeNull()

  await page.goto("/dashboard")
  await expect(page).toHaveURL(/\/login$/)
  await expect(page.getByText(/sign in to your workspace/i)).toBeVisible()
  expect(await sessionCookies(page)).toEqual([])
})

test("a session cookie that does not decode still loads public pages and guards app pages", async ({ page, context, baseURL }) => {
  const garbled = [encode(JSON.stringify({ alg: "ES256", typ: "JWT" })), encode("not json"), encode("signature")].join(".")
  const session = { access_token: garbled, refresh_token: "garbled", token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user: { id: randomUUID() } }
  const plant = () => context.addCookies([{ name: authCookie, value: `base64-${encode(JSON.stringify(session))}`, url: baseURL! }])

  for (const path of ["/login", "/f/missing-form", "/portal/missing-portal"]) {
    await plant()
    const response = await page.goto(path)
    expect(response?.status(), path).toBeLessThan(500)
    expect(await sessionCookies(page), path).toEqual([])
  }
  await plant()
  await page.goto("/deals")
  await expect(page).toHaveURL(/\/login\?redirect=%2Fdeals$/)
  await expect(page.getByText(/sign in to your workspace/i)).toBeVisible()
})
