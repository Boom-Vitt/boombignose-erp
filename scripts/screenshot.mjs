import { chromium } from "@playwright/test"

const OUT = process.env.SHOT_DIR || "/private/tmp/claude-501/-Users-boomvitt-Desktop-boombignose-erp/d41c5d4c-7aae-402c-804b-a062a1a825c9/scratchpad"
const base = "http://localhost:3000"

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1320, height: 900 } })

await page.goto(`${base}/login`)
await page.getByRole("button", { name: /use demo account/i }).click()
await page.waitForURL("**/dashboard")
await page.waitForTimeout(900)

for (const [path, name] of [
  ["/dashboard", "dashboard"],
  ["/deals", "deals"],
  ["/finance", "finance"],
  ["/clients", "clients"],
  ["/templates", "templates"],
]) {
  await page.goto(`${base}${path}`)
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${OUT}/shot-${name}.png`, fullPage: true })
  console.log(`saved shot-${name}.png`)
}

await browser.close()
