import { beforeEach, expect, it, vi } from "vitest"
import { Children, isValidElement, type ReactNode } from "react"

const state = vi.hoisted(() => ({
  action: vi.fn(), toast: vi.fn(), operation: Promise.resolve(),
  values: [] as unknown[], index: 0,
}))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = typeof initial === "function" ? initial() : initial
    return [state.values[index], (value: unknown) => { state.values[index] = value }]
  },
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useTransition: () => [false, (task: () => Promise<void>) => { state.operation = task() }],
}))
vi.mock("sonner", () => ({ toast: { error: state.toast, success: vi.fn() } }))
vi.mock("@/app/(app)/quotes/actions", () => ({ convertQuoteToInvoice: state.action }))

import { ConvertQuoteButton } from "@/app/(app)/quotes/_components/convert-quote-button"

let orgId: string
const quoteId = "22222222-2222-4222-8222-222222222222"
const lineId = "33333333-3333-4333-8333-333333333333"
let values: Map<string, string>

beforeEach(() => {
  vi.clearAllMocks()
  state.action.mockReset()
  state.values = []
  orgId = crypto.randomUUID()
  values = new Map<string, string>()
  vi.stubGlobal("window", { sessionStorage: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value) },
    removeItem: (key: string) => { values.delete(key) },
  } })
})

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode)] : [])
}
function render(request: React.ComponentProps<typeof ConvertQuoteButton>["request"] = {}, disabled = false) {
  const props = { quoteId, orgId, request, disabled, label: "Convert", variant: "default" as const }
  state.index = 0
  const result = ConvertQuoteButton(props)
  const nodes = elements(result)
  const button = nodes.find((node) => typeof node.props.onClick === "function")!
  return { button, text: JSON.stringify(result), click: async () => { (button.props.onClick as () => void)(); await state.operation } }
}

it("acknowledges a successful Next redirect before preserving its navigation signal", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/finance/invoices/invoice-a;303;" })
  state.action.mockRejectedValue(redirect)
  await expect(render({ depositBps: 2500 }).click()).rejects.toBe(redirect)
  expect(state.toast).not.toHaveBeenCalled()
  expect([...values.values()]).toEqual([])
  state.action.mockResolvedValue({ error: "Rejected" })
  await render({ depositBps: 3000 }).click()
  expect(state.action.mock.calls[1][0].key).not.toBe(state.action.mock.calls[0][0].key)
  expect(state.action.mock.calls[1][0].depositBps).toBe(3000)
})

it("retains the pending request through an authentication redirect", async () => {
  const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/login;303;" })
  state.action.mockRejectedValueOnce(redirect).mockRejectedValueOnce(new Error("Connection lost"))
  await expect(render({ depositBps: 2500 }).click()).rejects.toBe(redirect)
  const original = state.action.mock.calls[0][0]
  state.values = []
  await render({ depositBps: 5000 }).click()
  expect(state.action.mock.calls[1][0]).toEqual(original)
})

it("keeps the same request after an explicit error so a changed form cannot create another command", async () => {
  state.action.mockResolvedValue({ error: "Conversion did not return an invoice. Retry this request." })
  await render({ depositBps: 2500 }).click()
  const original = state.action.mock.calls[0][0]
  state.values = []
  await render({ depositBps: 5000 }).click()
  expect(state.action.mock.calls[1][0]).toEqual(original)
})

it("recovers the original deposit after a transport failure, remount and invoice revision change", async () => {
  state.action.mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValueOnce({ error: "Retry" })
  await render({ depositBps: 2500 }).click()
  const original = state.action.mock.calls[0][0]
  state.values = []
  const recovery = render({ depositBps: 5000 }, true)
  expect(recovery.button.props.disabled).toBe(false)
  expect(recovery.text).toContain("25%")
  expect(recovery.text).toContain("Retry pending invoice")
  await recovery.click()
  expect(state.action.mock.calls[1][0]).toEqual(original)
  expect(state.toast).toHaveBeenCalledWith("The conversion result could not be confirmed. Retry to recover the same invoice.")
})

it("does not silently submit changed quantities while a request is unresolved", async () => {
  state.action.mockRejectedValue(new Error("Connection lost"))
  await render({ lines: [{ quote_item_id: lineId, quantity: "1.250" }] }).click()
  const original = state.action.mock.calls[0][0]
  await render({ lines: [{ quote_item_id: lineId, quantity: "2" }] }).click()
  expect(state.action.mock.calls[1][0]).toEqual(original)
  expect(render().text).toContain("1.250")
})

it("blocks a new command when it cannot survive a page refresh", async () => {
  Object.defineProperty(window, "sessionStorage", { configurable: true, get: () => { throw new Error("Blocked") } })
  state.action.mockRejectedValue(new Error("Connection lost"))
  await render({ depositSatang: 10001 }).click()
  expect(state.action).not.toHaveBeenCalled()
})

it("releases a definitively rejected command so the scope can be corrected", async () => {
  state.action.mockResolvedValueOnce({ error: "Deposit exceeds remaining quote value", rejected: true }).mockRejectedValueOnce(new Error("Connection lost"))
  await render({ depositBps: 5000 }).click()
  state.values = []
  await render({ depositBps: 2500 }).click()
  expect(state.action.mock.calls[1][0].depositBps).toBe(2500)
  expect(state.action.mock.calls[1][0].key).not.toBe(state.action.mock.calls[0][0].key)
})

it("blocks an invalid saved command instead of replacing an unresolved identity", async () => {
  values.set(`erp.quote.request:${orgId}:${quoteId}`, JSON.stringify({ key: "invalid", request: { depositBps: 2500 } }))
  const recovery = render({ depositBps: 5000 })
  expect(recovery.button.props.disabled).toBe(true)
  await recovery.click()
  expect(state.action).not.toHaveBeenCalled()
  expect(recovery.text).toContain("saved invoice request")
})

it("separates pending requests by active workspace", async () => {
  state.action.mockRejectedValue(new Error("Connection lost"))
  await render().click()
  orgId = crypto.randomUUID()
  await render().click()
  expect(state.action.mock.calls[0][0].key).not.toBe(state.action.mock.calls[1][0].key)
})
