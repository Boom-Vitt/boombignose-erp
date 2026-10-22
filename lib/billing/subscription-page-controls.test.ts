import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"

const state = vi.hoisted(() => ({
  values: [] as unknown[], index: 0, operation: Promise.resolve(),
  setStatus: vi.fn(), refresh: vi.fn(),
}))
vi.mock("react", async (original) => ({
  ...await original<typeof import("react")>(),
  useState: (initial: unknown) => {
    const index = state.index++
    if (!(index in state.values)) state.values[index] = initial
    return [state.values[index], (value: unknown) => { state.values[index] = value }]
  },
  useSyncExternalStore: () => null,
  useTransition: () => [false, (task: () => Promise<void>) => { state.operation = task() }],
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: state.refresh }), notFound: () => { throw new Error("not-found") } }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => ({ orgId: "org", role: "owner" }) }))
vi.mock("@/lib/products/queries", () => ({ activeProductOptions: async () => [] }))
vi.mock("@/app/(app)/finance/subscription-actions", () => ({
  setSubscriptionStatus: state.setStatus, updateSubscription: vi.fn(), generateInvoiceNow: vi.fn(), deleteSubscription: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: (table: string) => {
  const rows = table === "subscriptions" ? [{
    id: "subscription", name: "Support", status: "paused", client_id: "client", project_id: null,
    amount_satang: 10000, interval: "monthly", start_date: "2026-01-01", next_run_date: "2026-02-01",
    last_generated_on: null, auto_generate: false, notes: null, product_id: null, unit: "period",
    tax_rate_bps: 700, wht_rate_bps: 300, prices_include_vat: false, clients: { name: "Client" },
  }] : []
  const query = {
    select: () => query, eq: () => query, order: () => query, limit: () => query,
    maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
    then: (resolve: (result: unknown) => unknown) => resolve({ data: rows, count: 0, error: null }),
  }
  return query
} }) }))

import SubscriptionDetailPage from "@/app/(app)/finance/subscriptions/[id]/page"
import { SubscriptionControls } from "@/app/(app)/finance/_components/subscription-controls"
import { StatusBar } from "@/components/record/status-bar"

function elements(node: ReactNode): ReactElement<Record<string, unknown>>[] {
  return Children.toArray(node).flatMap((child) => isValidElement<Record<string, unknown>>(child) ? [child, ...elements(child.props.children as ReactNode)] : [])
}

beforeEach(() => {
  vi.clearAllMocks()
  state.values = []
  state.index = 0
  state.setStatus.mockResolvedValue({})
})

it("keeps cancellation but offers no status-bar activation that bypasses the paused resume policy", async () => {
  const nodes = elements(await SubscriptionDetailPage({ params: Promise.resolve({ id: "subscription" }) }))
  const bar = nodes.find(node => node.type === StatusBar)!
  const actions = elements(StatusBar(bar.props as React.ComponentProps<typeof StatusBar>)).filter(node => typeof node.props.transition === "function")
  expect(actions.map(node => node.props.label)).toEqual(["Cancel subscription"])
  expect(nodes.find(node => node.type === SubscriptionControls)).toBeDefined()
})

it.each([false, true])("resumes through the dedicated control with bill missed periods set to %s", async (billMissedPeriods) => {
  const nodes = elements(await SubscriptionDetailPage({ params: Promise.resolve({ id: "subscription" }) }))
  const props = nodes.find(node => node.type === SubscriptionControls)!.props as React.ComponentProps<typeof SubscriptionControls>
  function controls() {
    state.index = 0
    return elements(SubscriptionControls(props))
  }
  const checkbox = controls().find(node => node.props.type === "checkbox")!
  ;(checkbox.props.onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: billMissedPeriods } })
  const resume = controls().find(node => node.props.children === "Resume subscription")!
  ;(resume.props.onClick as () => void)()
  await state.operation
  expect(state.setStatus).toHaveBeenCalledExactlyOnceWith({ id: "subscription", status: "active", bill_missed_periods: billMissedPeriods })
  expect(state.refresh).toHaveBeenCalledOnce()
})
