import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

import { searchQueries } from "../lib/search/query"
import { loginDemo } from "./auth"

test("command palette opens from the keyboard and goes to Quotes", async ({ page }) => {
  await loginDemo(page)

  const palette = page.getByRole("dialog", { name: "Command palette" })
  // Retried: the shortcut listener attaches after hydration.
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await expect(palette.getByRole("combobox", { name: "Search commands and records" })).toBeFocused()

  await page.keyboard.type("quotes")
  await expect(palette.getByRole("option", { name: "Quotes", exact: true })).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")

  await page.waitForURL("**/quotes")
  await expect(palette).toBeHidden()

  await page.keyboard.press("ControlOrMeta+k")
  await expect(palette).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(palette).toBeHidden()
})

test("a late Actions answer keeps the option the user arrowed to", async ({ page }) => {
  const quote = "/quotes/90000000-0000-0000-0000-000000000001"
  await loginDemo(page)
  let release = () => {}
  const held = new Promise<void>((resolve) => (release = resolve))
  let heldRequest = () => {}
  const requested = new Promise<void>((resolve) => (heldRequest = resolve))
  await page.route(`**${quote}`, async (route) => {
    if (route.request().method() === "POST" && route.request().headers()["next-action"]) {
      heldRequest()
      await held
    }
    await route.continue()
  })
  await page.goto(quote)

  const palette = page.getByRole("dialog", { name: "Command palette" })
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await requested

  const quotes = palette.getByRole("option", { name: "Quotes", exact: true })
  await expect(async () => {
    if ((await quotes.getAttribute("aria-selected")) !== "true") await page.keyboard.press("ArrowDown")
    await expect(quotes).toHaveAttribute("aria-selected", "true", { timeout: 200 })
  }).toPass()

  release()
  await expect(palette.getByRole("group", { name: "Actions" })).toBeVisible()
  await expect(quotes).toHaveAttribute("aria-selected", "true")
  await page.keyboard.press("Enter")
  await page.waitForURL("**/quotes")
})

test("record search finds a client by part of its name", async ({ page }) => {
  await loginDemo(page)
  const palette = page.getByRole("dialog", { name: "Command palette" })
  await expect(async () => {
    await page.keyboard.press("ControlOrMeta+k")
    await expect(palette).toBeVisible({ timeout: 1_000 })
  }).toPass()
  await page.keyboard.type("thai delight")
  await expect(palette.getByRole("option", { name: /Krua Thai Delight Co\./ })).toBeVisible()
})

test("record search filters match *, %, _, \\, . and quotes literally through PostgREST", async () => {
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  })
  const { data: seeded } = await admin.from("clients").select("org_id").eq("name", "Krua Thai Delight Co.").single()
  const tag = `lit${Date.now()}`
  const marks = ["*", "%", "_", "\\", ".", '"', "A"]
  const { data: rows, error } = await admin
    .from("clients")
    .insert(marks.map((mark) => ({ org_id: seeded!.org_id, name: `${tag} q${mark}7` })))
    .select("id, name")
  expect(error).toBeNull()
  try {
    for (const mark of marks) {
      const [clients] = searchQueries(`${tag} q${mark}7`)
      const { data } = await admin.from("clients").select("name").eq("org_id", seeded!.org_id).or(clients.filter)
      expect(data?.map((row) => row.name)).toEqual([`${tag} q${mark}7`])
    }
  } finally {
    await admin.from("clients").delete().in("id", rows!.map((row) => row.id))
  }
})
