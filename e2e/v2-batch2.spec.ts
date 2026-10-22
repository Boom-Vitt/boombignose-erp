import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { loginDemo } from "./auth"
import { community } from "./edition"

/**
 * V2 Batch 2 smoke: accounting sync scaffold (connect → sync → sync-map row) and
 * AI graceful degradation with no OPENROUTER_API_KEY. Needs the local Supabase
 * stack running/seeded with env loaded (`set -a && . ./.env.local`).
 */

const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } }
  )

const ALL = "00000000-0000-0000-0000-000000000000"

test("accounting: connect a provider then sync an invoice records a synced map row", async ({
  page,
}) => {
  test.skip(community, "Accounting integrations are Pro-only (BBN_EDITION=pro)")
  test.setTimeout(90_000) // dev server compiles routes/actions lazily on first hit
  const a = admin()
  // Clean slate so the connect/sync flow is deterministic.
  await a.from("accounting_sync_map").delete().neq("id", ALL)
  await a.from("accounting_connections").delete().neq("id", ALL)

  await loginDemo(page)
  await page.goto("/settings/accounting")
  await page.getByRole("button", { name: /^connect$/i }).click()
  // After connecting, the Disconnect control appears (page refreshes).
  await expect(page.getByRole("button", { name: /disconnect/i })).toBeVisible({
    timeout: 20_000,
  })

  const { data: inv } = await a
    .from("invoices")
    .select("id")
    .limit(1)
    .single()
  await page.goto(`/finance/invoices/${inv!.id}`)
  await page
    .getByRole("button", { name: /sync to accounting/i })
    .click({ timeout: 20_000 })

  // A synced row is written for this invoice.
  await expect
    .poll(
      async () => {
        const { count } = await a
          .from("accounting_sync_map")
          .select("*", { count: "exact", head: true })
          .eq("local_id", inv!.id)
          .eq("status", "synced")
        return count ?? 0
      },
      { timeout: 20_000 }
    )
    .toBeGreaterThan(0)

  // And the invoice page surfaces the external id.
  await expect(page.getByText(/FLOWACCOUNT-/i).first()).toBeVisible({
    timeout: 15_000,
  })
})

test("AI features degrade gracefully when no OPENROUTER_API_KEY is set", async ({
  page,
}) => {
  test.setTimeout(90_000) // dev server compiles routes/actions lazily on first hit
  const a = admin()
  const { data: deal } = await a.from("deals").select("id").limit(1).single()

  await loginDemo(page)
  await page.goto(`/deals/${deal!.id}`)
  await page.getByRole("button", { name: /summarize deal/i }).click()
  await expect(page.getByText(/not configured/i).first()).toBeVisible({
    timeout: 20_000,
  })

  await page.goto("/intake")
  await page
    .getByRole("textbox")
    .first()
    .fill("Met Acme. They want a website. Follow up next week.")
  await page.getByRole("button", { name: /summarize|extract/i }).click()
  await expect(page.getByText(/not configured/i).first()).toBeVisible({
    timeout: 20_000,
  })
})
