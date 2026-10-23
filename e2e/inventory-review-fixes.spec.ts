import { test, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import type { Database } from "@/lib/types/database"
import { todayISO } from "@/lib/dates"
import { loginDemo } from "./auth"

const org = "a0000000-0000-0000-0000-000000000001"
async function owner() {
  const db = createClient<Database>(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  const login = await db.auth.signInWithPassword({ email: "demo@boombignose.org", password: "BoomDemo123!" })
  expect(login.error).toBeNull()
  return { db, userId: login.data.user!.id }
}

test("received and billed orders allow additional receipts up to the tolerance", async ({ page }) => {
  const { db } = await owner()
  const policy = await db.from("org_settings").select("over_receipt_tolerance_percent,purchase_approval_threshold_satang").eq("org_id", org).single()
  expect(policy.error).toBeNull()
  try {
    expect((await db.from("org_settings").update({ over_receipt_tolerance_percent: 10, purchase_approval_threshold_satang: null }).eq("org_id", org)).error).toBeNull()
    const name = `Receipt capacity ${crypto.randomUUID()}`
    const product = await db.from("products").insert({ org_id: org, name, type: "goods", is_stockable: true, unit: "piece", cost_satang: 100 }).select("id").single()
    expect(product.error).toBeNull()
    const order = await db.rpc("create_purchase_order", { p_org_id: org, p_vendor_id: "a6000000-0000-4000-8000-000000000001", p_order_date: todayISO() })
    expect(order.error).toBeNull()
    expect((await db.from("purchase_order_items").insert({ org_id: org, purchase_order_id: order.data!, product_id: product.data!.id, description: name, quantity: 10, unit: "piece", unit_cost_satang: 100 })).error).toBeNull()
    expect((await db.rpc("transition_purchase_order", { p_org_id: org, p_order_id: order.data!, p_status: "confirmed" })).error).toBeNull()
    await loginDemo(page)
    await page.goto(`/purchases/${order.data}`)
    const quantity = page.getByLabel(`Received total for ${name}`, { exact: true })
    await quantity.fill("10")
    await page.getByRole("button", { name: "Record receipt", exact: true }).click()
    await expect(page.getByRole("link", { name: "Receipts 1", exact: true })).toBeVisible()
    expect((await db.from("purchase_orders").select("status").eq("id", order.data!).single()).data?.status).toBe("received")
    await expect(quantity).toBeVisible()
    await expect(page.getByText("Up to 11 piece total; 1 piece still allowed.", { exact: true })).toBeVisible()
    await expect(quantity).toHaveAttribute("max", "11")
    await quantity.fill("11.001")
    expect(await quantity.evaluate((input: HTMLInputElement) => input.checkValidity())).toBe(false)
    await quantity.fill("10.5")
    await page.getByRole("button", { name: "Record receipt", exact: true }).click()
    await expect(page.getByRole("link", { name: "Receipts 2", exact: true })).toBeVisible()
    expect((await db.rpc("bill_purchase_order", { p_org_id: org, p_order_id: order.data! })).error).toBeNull()
    await page.reload()
    expect((await db.from("purchase_orders").select("status").eq("id", order.data!).single()).data?.status).toBe("billed")
    await expect(quantity).toBeVisible()
    await expect(page.getByText("Up to 11 piece total; 0.5 piece still allowed.", { exact: true })).toBeVisible()
    await quantity.fill("11")
    await page.getByRole("button", { name: "Record receipt", exact: true }).click()
    await expect(page.getByRole("link", { name: "Receipts 3", exact: true })).toBeVisible()
    await expect(quantity).toHaveCount(0)
    expect((await db.from("purchase_order_items").select("received_quantity").eq("purchase_order_id", order.data!).single()).data?.received_quantity).toBe(11)
  } finally {
    expect((await db.from("org_settings").update(policy.data!).eq("org_id", org)).error).toBeNull()
  }
})

for (const archived of [false, true]) {
  test(`reloaded saved transfer displays the retried command${archived ? " with filtered records" : ""}`, async ({ page }) => {
    const { db, userId } = await owner()
    const suffix = crypto.randomUUID().slice(0, 8)
    const product = await db.from("products").insert({ org_id: org, name: `ZZ saved ${suffix}`, type: "goods", is_stockable: true, unit: "piece", cost_satang: 100 }).select("id,name").single()
    expect(product.error).toBeNull()
    const from = await db.rpc("save_warehouse", { p_org_id: org, p_id: null, p_code: `SF-${suffix}`, p_name: `Saved source ${suffix}`, p_address: null, p_default: false, p_active: true })
    const to = await db.rpc("save_warehouse", { p_org_id: org, p_id: null, p_code: `ST-${suffix}`, p_name: `Saved target ${suffix}`, p_address: null, p_default: false, p_active: true })
    expect(from.error).toBeNull()
    expect(to.error).toBeNull()
    expect((await db.rpc("adjust_stock", { p_org_id: org, p_product_id: product.data!.id, p_warehouse_id: from.data!, p_count: 0.5, p_unit_cost_satang: 100, p_reason: "Saved transfer fixture", p_key: crypto.randomUUID() })).error).toBeNull()
    const command = { product_id: product.data!.id, from_warehouse_id: from.data!, to_warehouse_id: to.data!, quantity: 0.5, reason: `Recovered ${suffix}`, key: crypto.randomUUID() }
    expect((await db.rpc("transfer_stock", { p_org_id: org, p_product_id: command.product_id, p_from_warehouse_id: command.from_warehouse_id, p_to_warehouse_id: command.to_warehouse_id, p_quantity: command.quantity, p_reason: command.reason, p_key: command.key })).error).toBeNull()
    if (archived) {
      expect((await db.from("products").update({ active: false }).eq("id", product.data!.id)).error).toBeNull()
      expect((await db.rpc("save_warehouse", { p_org_id: org, p_id: from.data!, p_code: `SF-${suffix}`, p_name: `Saved source ${suffix}`, p_address: null, p_default: false, p_active: false })).error).toBeNull()
    }
    await loginDemo(page)
    await page.goto("/inventory/transfer")
    await page.evaluate(({ storageKey, command }) => sessionStorage.setItem(storageKey, JSON.stringify(command)), { storageKey: `erp/inventory-transfer/${org}/${userId}`, command })
    await page.reload()
    const retry = page.getByRole("button", { name: "Retry saved transfer", exact: true })
    await expect(retry).toBeVisible()
    await expect(page.getByLabel("Product", { exact: true })).toHaveValue(command.product_id)
    await expect(page.getByLabel("Product", { exact: true }).locator("option:checked")).toHaveText(new RegExp(product.data!.name))
    await expect(page.getByLabel("From warehouse", { exact: true })).toHaveValue(command.from_warehouse_id)
    await expect(page.getByLabel("To warehouse", { exact: true })).toHaveValue(command.to_warehouse_id)
    await expect(page.getByLabel("Quantity", { exact: true })).toHaveValue("0.5")
    await expect(page.getByLabel("Reason", { exact: true })).toHaveValue(command.reason)
    await expect(page.getByLabel("Product", { exact: true })).toBeDisabled()
    await retry.click()
    await expect(page.getByText("Stock transferred.", { exact: true })).toBeVisible()
    expect((await db.from("stock_moves").select("id", { count: "exact" }).eq("org_id", org).eq("source_type", "transfer").eq("source_id", command.key)).count).toBe(2)
    expect(await page.evaluate(storageKey => sessionStorage.getItem(storageKey), `erp/inventory-transfer/${org}/${userId}`)).toBeNull()
  })
}
