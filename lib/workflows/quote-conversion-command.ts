import { z } from "zod"
import { serviceQuantityInput } from "./service"

type RequestStore = Pick<Storage, "getItem" | "setItem" | "removeItem">
const Request = z.object({
  lines: z.array(z.object({
    quote_item_id: z.guid(),
    quantity: z.union([z.string(), z.number()]).refine((value) => serviceQuantityInput.safeParse(value).success),
  }).strict()).min(1).optional(),
  depositBps: z.number().int().min(1).max(10000).optional(),
  depositSatang: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().refine((value) => [value.lines, value.depositBps, value.depositSatang].filter((item) => item !== undefined).length <= 1)
  .refine((value) => !value.lines || new Set(value.lines.map((line) => line.quote_item_id)).size === value.lines.length)
const Command = z.object({ orgId: z.guid(), quoteId: z.guid(), key: z.uuid(), request: Request }).strict()
export type QuoteConversionCommand = z.infer<typeof Command>
export type QuoteConversionRequest = z.infer<typeof Request>
const memory = new Map<string, QuoteConversionCommand | null>()
const storageKey = (orgId: string, quoteId: string) => `erp.quote.request:${orgId}:${quoteId}`

export function readQuoteConversionCommand(store: RequestStore | null, orgId: string, quoteId: string): QuoteConversionCommand | null {
  const name = storageKey(orgId, quoteId)
  if (memory.has(name)) return memory.get(name) ?? null
  let raw: string | null
  try {
    if (!store) throw new Error("Browser storage unavailable")
    raw = store.getItem(name)
  } catch { throw new Error("Browser storage is unavailable. Enable it before creating an invoice.") }
  if (!raw) return null
  try {
    const command = Command.parse(JSON.parse(raw))
    if (command.orgId !== orgId || command.quoteId !== quoteId) throw new Error("Mismatched saved request")
    memory.set(name, command)
    return command
  } catch { throw new Error("The saved invoice request is invalid. Resolve it before creating another invoice.") }
}

export function beginQuoteConversionCommand(store: RequestStore | null, orgId: string, quoteId: string, request: QuoteConversionRequest, newKey: () => string): QuoteConversionCommand {
  const pending = readQuoteConversionCommand(store, orgId, quoteId)
  if (pending) return pending
  const command = Command.parse({ orgId, quoteId, key: newKey(), request })
  const name = storageKey(orgId, quoteId)
  try {
    const raw = JSON.stringify(command)
    if (!store) throw new Error("Browser storage unavailable")
    store.setItem(name, raw)
    if (store.getItem(name) !== raw) throw new Error("Invoice request was not saved")
  } catch { throw new Error("Could not save the invoice request. Enable browser storage and retry.") }
  memory.set(name, command)
  return command
}

export function acknowledgeQuoteConversionCommand(store: RequestStore | null, orgId: string, quoteId: string, key: string): void {
  if (readQuoteConversionCommand(store, orgId, quoteId)?.key !== key) return
  const name = storageKey(orgId, quoteId)
  memory.set(name, null)
  try { store?.removeItem(name) } catch { /* Keep the acknowledgement in memory if storage is blocked. */ }
}
