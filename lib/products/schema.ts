import { z } from "zod"
import { serviceMoneyInput } from "@/lib/workflows/service"

export const ProductInput = z.object({
  sku: z.string().trim().max(80).default(""),
  name: z.string().trim().min(1, "Name is required").max(200),
  description: z.string().trim().max(4000).default(""),
  type: z.enum(["service", "goods"]),
  unit: z.string().trim().min(1, "Unit is required").max(40),
  listPriceBaht: serviceMoneyInput,
  costBaht: serviceMoneyInput,
  taxRateBps: z.number().int().min(0).max(10000),
  isStockable: z.boolean(),
})

export type ProductFormValues = z.input<typeof ProductInput>

export const ProductLineInput = z.object({
  product_id: z.uuid().nullable().optional(),
  unit: z.string().trim().min(1).max(40).nullable().optional(),
})
