import { z } from "zod"
import { Constants } from "@/lib/types/database"
import { serviceAmountSatang } from "@/lib/workflows/service"

export const ClaimInput = z.object({ title: z.string().trim().min(1).max(200) })

export const ExpenseLineInput = z.object({
  claim_id: z.guid(),
  spent_on: z.iso.date(),
  category: z.enum(Constants.public.Enums.cost_category),
  description: z.string().trim().min(1).max(1000),
  amountBaht: z.union([z.string(), z.number()]).refine(value => {
    try { return serviceAmountSatang(value) > 0 } catch { return false }
  }, "Enter a THB amount above zero with up to two decimals"),
  project_id: z.union([z.guid(), z.literal("")]).transform(value => value || null),
}).transform(({ amountBaht, ...line }) => ({ ...line, amount_satang: serviceAmountSatang(amountBaht) }))

export const RejectInput = z.object({ note: z.string().trim().min(1).max(2000) })
