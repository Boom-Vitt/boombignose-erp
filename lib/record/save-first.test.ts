import type { ReactElement } from "react"
import { afterEach, expect, it, vi } from "vitest"

// The buttons are called as functions; transitions run at once and refs keep one slot.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useTransition: () => [false, (task: () => unknown) => { void task() }],
  useRef: (initial: unknown) => ({ current: initial }),
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: vi.fn() }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn(), warning: vi.fn() } }))
const calls = vi.hoisted(() => [] as string[])
vi.mock("@/app/(app)/quotes/email-actions", () => ({ sendQuoteEmail: vi.fn(async () => { calls.push("email quote"); return {} }) }))
vi.mock("@/app/(app)/finance/email-actions", () => ({ sendInvoiceEmail: vi.fn(async () => { calls.push("email invoice"); return {} }) }))
vi.mock("@/app/(app)/quotes/actions", () => ({ convertQuoteToInvoice: vi.fn(async () => { calls.push("convert"); return {} }) }))

import { recordGuard } from "@/components/record/record-guard"
import { EmailQuoteButton } from "@/app/(app)/quotes/_components/email-quote-button"
import { ConvertQuoteButton } from "@/app/(app)/quotes/_components/convert-quote-button"
import { EmailInvoiceButton } from "@/app/(app)/finance/_components/email-invoice-button"

const buttons: [string, () => ReactElement<{ onClick: () => void }>][] = [
  ["email quote", () => EmailQuoteButton({ quoteId: "q1" }) as ReactElement<{ onClick: () => void }>],
  ["email invoice", () => EmailInvoiceButton({ invoiceId: "i1" }) as ReactElement<{ onClick: () => void }>],
  ["convert", () => ConvertQuoteButton({ quoteId: "q1", orgId: "o1", label: "Convert", variant: "default" }) as ReactElement<{ onClick: () => void }>],
]

afterEach(() => {
  recordGuard.setForm("header", null)
  calls.length = 0
})

it.each(buttons)("%s saves the unsaved header first", async (name, button) => {
  recordGuard.setForm("header", { dirty: true, save: async () => { calls.push("save"); return true } })
  button().props.onClick()
  await vi.waitFor(() => expect(calls).toEqual(["save", name]))
})

it.each(buttons)("%s does not run when the header cannot be saved", async (_name, button) => {
  recordGuard.setForm("header", { dirty: true, save: async () => { calls.push("save"); return false } })
  button().props.onClick()
  await vi.waitFor(() => expect(calls).toEqual(["save"]))
  await new Promise((done) => setTimeout(done, 10))
  expect(calls).toEqual(["save"])
})
