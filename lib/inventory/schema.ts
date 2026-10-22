import { z } from "zod"

const quantity = z.coerce.number().finite().min(0).max(999999999.999).refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001, "Use at most three decimal places")
export const WarehouseInput = z.object({
  id: z.uuid().nullable(), code: z.string().trim().min(1).max(40), name: z.string().trim().min(1).max(200),
  address: z.string().trim().max(2000).transform(value => value || null), is_default: z.boolean(), active: z.boolean(),
})
export const CountInput = z.object({ product_id: z.uuid(), warehouse_id: z.uuid(), quantity, reason: z.string().trim().min(1).max(2000), key: z.uuid() })
export const ReorderInput = z.object({ product_id: z.uuid(), reorder_min: quantity, reorder_qty: quantity, default_vendor_id: z.union([z.uuid(), z.literal("")]).transform(value => value || null) })
