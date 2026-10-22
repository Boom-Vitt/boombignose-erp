import { beforeEach, expect, it, vi } from "vitest"
import { Children, isValidElement, type ReactNode } from "react"

const state = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, action: vi.fn(), operation: Promise.resolve(),
  ref: { current: null as { scope: string; key: string } | null },
}))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => [state.values[state.index++] ?? initial, vi.fn()],
  useRef: () => state.ref,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useTransition: () => [false, (task: () => Promise<void>) => { state.operation = task() }],
}))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))
vi.mock("@/app/(app)/quotes/actions", () => ({ convertQuoteToInvoice: state.action }))

import { QuoteInvoiceForm } from "@/app/(app)/quotes/_components/quote-invoice-form"
import { ConvertQuoteButton } from "@/app/(app)/quotes/_components/convert-quote-button"

function elements(node: ReactNode): React.ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode)] : [])
}

function control(mode: string, quantities: Record<string, string> = {}, deposit = "") {
  state.index = 0
  state.values = [mode, quantities, deposit]
  return elements(QuoteInvoiceForm({ quoteId: "quote", orgId: "org", lines: [{ id: "line", description: "Service", quantity: 5, invoiced_quantity: 2 }], label: "Invoice", variant: "default" }))
    .find((node) => node.type === ConvertQuoteButton)!
}

beforeEach(() => {
  vi.clearAllMocks()
  state.ref.current = null
  state.action.mockResolvedValue({ error: "Retry" })
  const keys = new Map<string, string>()
  vi.stubGlobal("window", { sessionStorage: { getItem: (key: string) => keys.get(key) ?? null, setItem: (key: string, value: string) => keys.set(key, value) } })
})

it("selects only entered quantities within the unbilled scope", () => {
  expect(control("selected", { line: "2.125" }).props).toMatchObject({ request: { lines: [{ quote_item_id: "line", quantity: "2.125" }] }, disabled: false })
})

it.each(["", "0", "3.001", "1.0001", "-1", "invalid"])("blocks invalid selected quantity %s", (quantity) => {
  expect(control("selected", { line: quantity }).props.disabled).toBe(true)
})

it("converts percent to exact basis points and THB to satang", () => {
  expect(control("deposit_percent", {}, "25.25").props).toMatchObject({ request: { depositBps: 2525 }, disabled: false })
  expect(control("deposit_amount", {}, "100.01").props).toMatchObject({ request: { depositSatang: 10001 }, disabled: false })
})

it.each(["0", "100.01", "1.001", "invalid"])("blocks invalid deposit percentage %s", (deposit) => {
  expect(control("deposit_percent", {}, deposit).props.disabled).toBe(true)
})

it("retains the complete original request despite changed quantities or invoice progress", async () => {
  const quoteId = crypto.randomUUID()
  const orgId = crypto.randomUUID()
  const lineId = crypto.randomUUID()
  const click = async (quantity: number) => {
    state.index = 0
    const button = elements(ConvertQuoteButton({ quoteId, orgId, request: { lines: [{ quote_item_id: lineId, quantity }] }, label: "Invoice", variant: "default" })).find((node) => typeof node.props.onClick === "function")!
    ;(button.props.onClick as () => void)()
    await state.operation
  }
  await click(1)
  await click(1)
  await click(1)
  await click(2)
  const keys = state.action.mock.calls.map((call) => call[0].key)
  expect(keys[0]).toBe(keys[1])
  expect(new Set(keys).size).toBe(1)
  expect(state.action.mock.calls[3][0].lines).toEqual([{ quote_item_id: lineId, quantity: 1 }])
})
