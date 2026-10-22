import { CountInput } from "./schema"
import type { z } from "zod"

export type CountCommand = z.output<typeof CountInput>
type BrowserStore = Pick<Storage, "getItem" | "setItem" | "removeItem">

export function prepareCountCommand(store: BrowserStore | null, scope: string, details: Omit<CountCommand, "key">, createKey: () => string): CountCommand {
  return CountInput.parse({ ...details, key: createKey() })
}
