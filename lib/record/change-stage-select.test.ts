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

import { updateDealStage } from "@/app/(app)/deals/actions"
import { ChangeStageSelect } from "@/app/(app)/deals/_components/change-stage-select"
import type { Enums } from "@/lib/types/database"

function render(stage: Enums<"deal_stage">) {
  let element
  do {
    hooks.index = 0
    hooks.dirty = false
    element = ChangeStageSelect({
      dealId: "deal-a",
      dealTitle: "Deal A",
      stage,
      lostReasons: [{ id: "reason-1", name: "No budget" }],
      canManageReasons: false,
    })
  } while (hooks.dirty)
  const [select, reasonDialog] = element.props.children
  return { select, reasonDialog }
}

beforeEach(() => {
  hooks.slots = []
  vi.clearAllMocks()
})

it("follows a stage changed elsewhere, such as the status bar", () => {
  expect(render("lead").select.props.value).toBe("lead")
  expect(render("contacted").select.props.value).toBe("contacted")
})

it("reverts a rejected choice to the current stage", async () => {
  render("lead").select.props.onValueChange("won")
  expect(render("lead").select.props.value).toBe("won")
  await hooks.task
  expect(render("lead").select.props.value).toBe("lead")
})

it("asks for a lost reason instead of marking the deal lost straight away", async () => {
  render("lead").select.props.onValueChange("lost")
  const { select, reasonDialog } = render("lead")
  expect(select.props.value).toBe("lead")
  expect(reasonDialog.props.open).toBe(true)
  expect(updateDealStage).not.toHaveBeenCalled()

  await reasonDialog.props.onConfirm("reason-1")
  expect(updateDealStage).toHaveBeenCalledWith("deal-a", "lost", { lostReasonId: "reason-1" })
})
