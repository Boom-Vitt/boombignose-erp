import { beforeEach, expect, it, vi } from "vitest"

// Keeps useState slots across calls like one mounted instance, and re-runs a render that set state.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0, dirty: false, task: Promise.resolve() }))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = hooks.index++
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial
    return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = next; hooks.dirty = true }]
  },
  useTransition: () => [false, (task: () => Promise<void>) => { hooks.task = task() }],
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock("@/app/(app)/deals/actions", () => ({ updateDealStage: vi.fn(async () => ({ error: "Not allowed" })) }))

import { ChangeStageSelect } from "@/app/(app)/deals/_components/change-stage-select"
import type { Enums } from "@/lib/types/database"

function render(stage: Enums<"deal_stage">) {
  let element
  do {
    hooks.index = 0
    hooks.dirty = false
    element = ChangeStageSelect({ dealId: "deal-a", stage })
  } while (hooks.dirty)
  return element
}

beforeEach(() => {
  hooks.slots = []
})

it("follows a stage changed elsewhere, such as the status bar", () => {
  expect(render("lead").props.value).toBe("lead")
  expect(render("contacted").props.value).toBe("contacted")
})

it("reverts a rejected choice to the current stage", async () => {
  render("lead").props.onValueChange("won")
  expect(render("lead").props.value).toBe("won")
  await hooks.task
  expect(render("lead").props.value).toBe("lead")
})
