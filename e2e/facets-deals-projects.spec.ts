import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

import { loginDemo } from "./auth"

test.use({ viewport: { width: 1440, height: 900 } })

const admin = () =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })

test("a stage filter chip narrows the deals board and clears back", async ({ page }) => {
  // Other specs move seeded deals between stages, so own one deal per asserted column.
  const a = admin()
  const { data: org } = await a.from("organizations").select("id").eq("slug", "boombignose").single()
  const { data: client } = await a.from("clients").select("id").eq("org_id", org!.id).limit(1).single()
  const { data: own, error } = await a.from("deals")
    .insert(["lead", "proposal"].map(stage => ({ org_id: org!.id, client_id: client!.id, title: `Facet ${stage} ${Date.now()}`, stage })))
    .select("id")
  expect(error).toBeNull()
  try {
    await stageFilterRoundTrip(page)
  } finally {
    await a.from("deals").delete().in("id", own!.map(d => d.id))
  }
})

async function stageFilterRoundTrip(page: import("@playwright/test").Page) {
  await loginDemo(page)
  await page.goto("/deals")
  const board = page.getByRole("region", { name: "Deals board" })
  await expect(board.getByRole("region", { name: "Lead", exact: true })).toBeVisible()

  await page.getByText("Filters, group by and saved views").click()
  await page.getByRole("link", { name: "Proposal", exact: true }).click()
  await expect(page).toHaveURL(/status=proposal/)
  const chip = page.getByRole("link", { name: "Remove Proposal" })
  await expect(chip).toBeVisible()
  await expect(board.getByRole("region", { name: "Proposal", exact: true })).toBeVisible()
  await expect(board.getByRole("region", { name: "Lead", exact: true })).toHaveCount(0)

  await chip.click()
  await expect(board.getByRole("region", { name: "Lead", exact: true })).toBeVisible()
}

test("deals list view groups by stage and keeps the view when filtering", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/deals?view=list&groupBy=stage")
  await expect(page.getByTestId("group-header").first()).toBeVisible()
  await expect(page.getByRole("link", { name: "Remove Group by: Stage" })).toBeVisible()

  await page.getByText("Filters, group by and saved views").click()
  await page.getByRole("link", { name: "My records" }).click()
  await expect(page).toHaveURL(/mine=1/)
  await expect(page).toHaveURL(/view=list/)
  await expect(page.getByRole("link", { name: "Board", exact: true })).toHaveAttribute("href", /mine=1/)
})

test("projects board honours a status filter and stays on the board", async ({ page }) => {
  await loginDemo(page)
  await page.goto("/projects?view=board")
  await page.getByText("Filters, group by and saved views").click()
  await page.getByRole("link", { name: "In Progress", exact: true }).click()

  await expect(page).toHaveURL(/status=in_progress/)
  await expect(page).toHaveURL(/view=board/)
  const board = page.getByRole("region", { name: "Projects board" })
  await expect(board.getByRole("region", { name: "In progress", exact: true })).toBeVisible()
  await expect(board.getByRole("region", { name: "Review", exact: true })).toHaveCount(0)
})
