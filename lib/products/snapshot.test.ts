import { describe, expect, it } from "vitest"
import { productToLineValues, type ProductOption } from "./snapshot"
import { ProductInput } from "./schema"
import { serviceAmountSatang, serviceLineAmount } from "@/lib/workflows/service"

const product: ProductOption = {
  id: "b5000000-0000-4000-8000-000000000001",
  sku: "TRAINING",
  name: "Team training session",
  description: "Hands-on team training",
  unit: "day",
  list_price_satang: 1000001,
}

describe("product line snapshots", () => {
  it("copies editable line values with an exact decimal price", () => {
    expect(productToLineValues(product)).toEqual({
      product_id: product.id, description: "Hands-on team training",
      unit: "day", unitPriceBaht: "10000.01",
    })
  })

  it("uses the product name when no description is supplied", () => {
    expect(productToLineValues({ ...product, description: null }).description).toBe(product.name)
    expect(productToLineValues({ ...product, description: "  " }).description).toBe(product.name)
  })

  it("keeps saved values independent from later catalog changes", () => {
    const source = { ...product }
    const line = productToLineValues(source)
    source.description = "Changed"
    source.list_price_satang = 5
    source.unit = "hour"
    expect(line).toMatchObject({ description: "Hands-on team training", unit: "day", unitPriceBaht: "10000.01" })
  })

  it.each([0, 1, 101, Number.MAX_SAFE_INTEGER])("round trips %i satang exactly", (price) => {
    expect(serviceAmountSatang(productToLineValues({ ...product, list_price_satang: price }).unitPriceBaht)).toBe(price)
  })

  it("uses integer satang and rounds fractional quantities once", () => {
    const line = productToLineValues({ ...product, list_price_satang: 101 })
    expect(serviceLineAmount("2.5", serviceAmountSatang(line.unitPriceBaht))).toBe(253)
    expect(serviceLineAmount("0.005", 100)).toBe(1)
    expect(() => serviceLineAmount("2", Number.MAX_SAFE_INTEGER)).toThrow()
  })

  it("rejects invalid or unsafe catalog prices and blank units", () => {
    const valid = { name: product.name, type: "service", unit: "day", listPriceBaht: "10000.01", costBaht: "0", taxRateBps: 0, isStockable: false }
    expect(ProductInput.safeParse(valid).success).toBe(true)
    for (const change of [{ listPriceBaht: "0.001" }, { costBaht: "-1" }, { listPriceBaht: "90071992547409.92" }, { unit: " " }, { taxRateBps: 10001 }, { name: " " }]) {
      expect(ProductInput.safeParse({ ...valid, ...change }).success).toBe(false)
    }
  })
})
