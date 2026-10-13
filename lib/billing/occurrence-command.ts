import { z } from "zod"

export type RequestStore = Pick<Storage, "getItem" | "setItem" | "removeItem">
const Command = z.object({ orgId: z.uuid(), subscriptionId: z.uuid(), occurrence: z.iso.date() })
const keyFor = (orgId: string, subId: string) => `erp.subscription.request:${orgId}:${subId}`

export function readInvoiceRequest(store: RequestStore, orgId: string, subId: string) {
  const raw = store.getItem(keyFor(orgId, subId))
  if (!raw) return null
  const command = Command.parse(JSON.parse(raw))
  if (command.orgId !== orgId || command.subscriptionId !== subId) throw new Error("Invalid saved invoice request")
  return command
}

export function beginInvoiceRequest(store: RequestStore, orgId: string, subId: string, occurrence: string) {
  const pending = readInvoiceRequest(store, orgId, subId)
  if (pending) return pending
  const command = Command.parse({ orgId, subscriptionId: subId, occurrence })
  store.setItem(keyFor(orgId, subId), JSON.stringify(command))
  return command
}

export function acknowledgeInvoiceRequest(store: RequestStore, orgId: string, subId: string, occurrence: string) {
  const pending = readInvoiceRequest(store, orgId, subId)
  if (pending?.occurrence === occurrence) store.removeItem(keyFor(orgId, subId))
}
