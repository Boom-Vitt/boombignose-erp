import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  action: vi.fn(), toast: vi.fn(), operation: Promise.resolve(),
  ref: { current: null as { scope: string; key: string } | null },
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useRef: () => state.ref,
  useTransition: () => [false, (task: () => Promise<void>) => { state.operation = task() }],
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
vi.mock("sonner", () => ({ toast: { error: state.toast, success: vi.fn() } }))
vi.mock("@/app/(app)/quotes/actions", () => ({ convertQuoteToInvoice: state.action }))

import { ConvertQuoteButton } from "@/app/(app)/quotes/_components/convert-quote-button"

beforeEach(() => {
  vi.clearAllMocks()
  state.action.mockReset()
  state.ref.current = null
  const values = new Map<string, string>()
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) } } })
})

function clickConversion(orgId = "org-a") {
  const element = ConvertQuoteButton({ quoteId: "quote-a", orgId, label: "Convert", variant: "default" })
  element.props.onClick()
  return state.operation
}

it("preserves Next navigation signals after successful conversion", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/finance/invoices/invoice-a;303;" })
  state.action.mockRejectedValue(redirect)
  await expect(clickConversion()).rejects.toBe(redirect)
  expect(state.toast).not.toHaveBeenCalled()
})

it("retains the command key after a transport failure", async () => {
  state.action.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ error: "Try again" })
  await clickConversion()
  await clickConversion()
  expect(state.action.mock.calls[0][0].key).toBe(state.action.mock.calls[1][0].key)
  expect(state.toast).toHaveBeenCalledWith("The conversion result could not be confirmed. Retry to recover the same invoice.")
})

it("changes command scope when the active workspace changes", async () => {
  state.action.mockResolvedValue({ error: "Try again" })
  await clickConversion("org-a")
  await clickConversion("org-b")
  expect(state.action.mock.calls[0][0].key).not.toBe(state.action.mock.calls[1][0].key)
})
