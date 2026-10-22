import { z } from "zod"
import { serviceMoneyInput, serviceQuantityInput } from "@/lib/workflows/service"

const optionalText = (max: number) => z.string().trim().max(max).transform(value => value || null)
export const VendorInput = z.object({
  name: z.string().trim().min(1).max(200),
  tax_id: optionalText(80),
  email: z.union([z.email().max(320), z.literal("")]).transform(value => value || null),
  phone: optionalText(80),
  address: optionalText(2000),
  payment_terms_days: z.coerce.number().int().min(0).max(3650),
  notes: optionalText(10000),
  active: z.boolean(),
})
export const PurchaseInput = z.object({
  vendor_id: z.guid(),
  order_date: z.iso.date(),
  expected_date: z.union([z.iso.date(), z.literal("")]).transform(value => value || null),
  notes: optionalText(10000),
})
export const LineInput = z.object({
  purchase_order_id: z.guid(),
  product_id: z.guid().nullable(),
  description: z.string().trim().min(1).max(4000),
  quantity: serviceQuantityInput,
  unit: z.string().trim().min(1).max(40),
  unitCostBaht: serviceMoneyInput,
})
export const ReceiptInput = z.array(z.object({ id: z.guid(), received_quantity: z.number().finite().nonnegative() })).min(1)
