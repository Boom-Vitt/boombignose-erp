import { CountInput } from "./schema"
import type { z } from "zod"

export type CountCommand = z.output<typeof CountInput>
type BrowserStore = Pick<Storage, "getItem" | "setItem" | "removeItem">
const storageKey = (scope: string) => `erp/inventory-count/${scope}`

export function readPendingCount(store: BrowserStore | null, scope: string): CountCommand | null {
  try {
    const parsed = CountInput.safeParse(JSON.parse(store?.getItem(storageKey(scope)) ?? "null"))
    return parsed.success ? parsed.data : null
  } catch { return null }
}

export function prepareCountCommand(store: BrowserStore | null, scope: string, details: Omit<CountCommand, "key">, createKey: () => string): CountCommand {
  const pending = readPendingCount(store, scope)
  const command = CountInput.parse({ ...details, key: pending?.key ?? createKey() })
  if (pending) {
    if (JSON.stringify(pending) !== JSON.stringify(command)) throw new Error("A saved count is awaiting confirmation. Retry it before entering a new count.")
    return pending
  }
  try {
    if (!store) throw new Error("No browser storage")
    const serialized = JSON.stringify(command)
    store.setItem(storageKey(scope), serialized)
    if (store.getItem(storageKey(scope)) !== serialized) throw new Error("Count was not persisted")
  } catch { throw new Error("Browser storage is unavailable. Enable it before recording a count.") }
  return command
}

export function acknowledgeCountCommand(store: BrowserStore | null, scope: string, key: string, response: { error?: string; rejected?: true }): boolean {
  if (response.error !== undefined && !response.rejected) return false
  try {
    const pending = readPendingCount(store, scope)
    if (!pending) return true
    if (pending.key !== key || !store) return false
    store.removeItem(storageKey(scope))
    return store.getItem(storageKey(scope)) === null
  } catch { return false }
}
