import { serviceAmountBaht } from "@/lib/workflows/service"
import type { Tables } from "@/lib/types/database"

export type ProductOption = Pick<Tables<"products">,
  "id" | "sku" | "name" | "description" | "unit" | "list_price_satang"> & { tax_rate_bps?: number; cost_satang?: number }

export function productToLineValues(product: ProductOption) {
  return {
    product_id: product.id,
    description: product.description?.trim() || product.name,
    unit: product.unit,
    unitPriceBaht: serviceAmountBaht(product.list_price_satang),
  }
}
