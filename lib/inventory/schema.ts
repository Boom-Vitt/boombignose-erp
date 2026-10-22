import { z } from "zod"

const quantity = z.coerce.number().finite().min(0).max(999999999.999).refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001, "Use at most three decimal places")
export const WarehouseInput = z.object({
  id: z.uuid().nullable(), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(2000).transform(value => value || null), is_default: z.boolean(), active: z.boolean(),
})
export const CountInput = z.object({ product_id: z.uuid(), warehouse_id: z.uuid(), quantity, reason: z.string().trim().min(1).max(2000), key: z.uuid() })
export const ReorderInput = z.object({ product_id: z.uuid(), reorder_min: quantity, reorder_qty: quantity, default_vendor_id: z.union([z.uuid(), z.literal("")]).transform(value => value || null) })

const satang = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const stockValue = z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)
export const InventorySnapshot = z.object({
  products: z.array(z.object({
    id: z.guid(), org_id: z.guid(), sku: z.string().nullable(), name: z.string(), description: z.string().nullable(),
    type: z.enum(["service", "goods"]), unit: z.string(), list_price_satang: satang, cost_satang: satang,
    tax_rate_bps: z.number().int().min(0).max(10000), is_stockable: z.boolean(), active: z.boolean(),
    reorder_min: z.number().finite(), reorder_qty: z.number().finite(), default_vendor_id: z.guid().nullable(),
    created_at: z.string(), updated_at: z.string(), quantity: z.number().finite(), value_satang: stockValue,
  })),
  balances: z.array(z.object({
    org_id: z.guid(), product_id: z.guid(), warehouse_id: z.guid(), quantity: z.number().finite(),
    average_cost_satang: satang, value_satang: stockValue,
  })),
})
