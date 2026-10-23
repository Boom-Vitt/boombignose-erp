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
export const ReceiptInput = z.array(z.object({ id: z.guid(), received_quantity: z.number().finite().nonnegative(), previous_received_quantity: z.number().finite().nonnegative() })).min(1)

export const ReturnInput = z.array(z.object({ id: z.guid(), returned_quantity: z.number().finite().nonnegative().max(999999999.999).refine(value => Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001, "Use at most three decimal places") })).min(1)

export const RFQClaim = z.object({
  delivery_key: z.uuid(),
  snapshot: z.object({
    to: z.email(),
    number: z.string().min(1),
    vendorName: z.string().min(1),
    orderDate: z.iso.date(),
    expectedDate: z.iso.date().nullable(),
    notes: z.string().nullable(),
    lines: z.array(z.object({
      description: z.string().min(1),
      quantity: serviceQuantityInput,
      unit: z.string().min(1),
      unit_cost_satang: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    })).min(1),
  }),
})

const satangInput = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const BillFields = z.object({
  vendor_reference: z.string().trim().min(1).max(200),
  bill_date: z.iso.date(),
  due_date: z.iso.date(),
  input_vat_rate: z.number().min(0).max(100).refine(value => Math.abs(value * 100 - Math.round(value * 100)) < 0.00001),
  input_vat_satang: satangInput,
  vendor_total_satang: satangInput,
  variance_reason: z.string().trim().max(2000),
  lines: z.array(z.object({ id: z.guid(), quantity: serviceQuantityInput, expected_quantity: serviceQuantityInput, unit_cost_satang: satangInput })).min(1),
})
export const BillInput = BillFields.refine(value => value.due_date >= value.bill_date && value.vendor_total_satang >= value.input_vat_satang)
export const CreditInput = BillFields.pick({ vendor_reference: true, bill_date: true, input_vat_rate: true, input_vat_satang: true, variance_reason: true }).extend({
  original_bill_id: z.guid(),
  cost_ids: z.array(z.guid()).min(1).optional(),
  lines: z.array(z.object({ id: z.guid(), quantity: serviceQuantityInput })).min(1),
})
