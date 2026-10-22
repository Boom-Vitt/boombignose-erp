import { isValidElement, type ReactElement, type ReactNode } from "react"
import { beforeEach, expect, it, vi } from "vitest"

// Calls the component as a function: hooks keep their slots between calls like one mounted instance.
const hooks = vi.hoisted(() => ({ slots: [] as unknown[], index: 0 }))
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useState: (initial: unknown) => {
    const slot = hooks.index++
    if (!(slot in hooks.slots)) hooks.slots[slot] = initial
    return [hooks.slots[slot], (next: unknown) => { hooks.slots[slot] = next }]
  },
  useId: () => "reason",
  useEffect: () => {},
  useTransition: () => [false, (task: () => unknown) => { void task() }],
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
}))
const refresh = vi.hoisted(() => vi.fn())
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
const logRecordNote = vi.hoisted(() => vi.fn(async () => ({})))
vi.mock("@/lib/record-history/actions", () => ({ logRecordNote }))

import { TransitionButton } from "@/components/record/transition-button"
import { AlertDialogAction } from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Props = Record<string, unknown> & { children?: ReactNode }
function find(node: ReactNode, type: unknown): ReactElement<Props> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, type)
      if (hit) return hit
    }
    return undefined
  }
  if (!isValidElement<Props>(node)) return undefined
  if (node.type === type) return node
  return find(node.props.children, type) ?? find(node.props.render as ReactNode, type)
}
function render(props: Parameters<typeof TransitionButton>[0]) {
  hooks.index = 0
  return TransitionButton(props) as ReactElement<Props>
}

beforeEach(() => {
  hooks.slots = []
  vi.clearAllMocks()
})

it("moves at once when the step is not destructive", async () => {
  const transition = vi.fn(async () => ({}))
  const tree = render({ label: "Mark won", to: "won", transition, variant: "outline" })
  expect(find(tree, AlertDialogAction)).toBeUndefined()
  expect(tree.type).toBe(Button)
  ;(tree.props.onClick as () => void)()
  await vi.waitFor(() => expect(refresh).toHaveBeenCalled())
  expect(transition).toHaveBeenCalledWith("won")
})

it("asks before a destructive move and keeps the reason in the record history", async () => {
  const transition = vi.fn(async () => ({}))
  const props = {
    label: "Mark lost", to: "lost" as const, transition, variant: "outline" as const,
    confirm: "The deal leaves the pipeline.", reason: true as const,
    record: { recordType: "deal" as const, recordId: "deal-1" },
  }
  let tree = render(props)
  expect(transition).not.toHaveBeenCalled()
  ;(find(tree, Textarea)!.props.onChange as (event: unknown) => void)({ target: { value: "  Budget cut  " } })
  tree = render(props)
  ;(find(tree, AlertDialogAction)!.props.onClick as () => void)()
  await vi.waitFor(() => expect(logRecordNote).toHaveBeenCalled())
  expect(transition).toHaveBeenCalledWith("lost")
  expect(logRecordNote).toHaveBeenCalledWith({ recordType: "deal", recordId: "deal-1", body: "Lost: Budget cut" })
})

it("does not keep a reason when the move is refused", async () => {
  const transition = vi.fn(async () => ({ error: "Not allowed" }))
  const props = {
    label: "Decline", to: "declined" as const, transition, variant: "outline" as const,
    confirm: "Closes the quote.", reason: true as const, record: { recordType: "quote" as const, recordId: "quote-1" },
  }
  ;(find(render(props), Textarea)!.props.onChange as (event: unknown) => void)({ target: { value: "Too expensive" } })
  ;(find(render(props), AlertDialogAction)!.props.onClick as () => void)()
  await vi.waitFor(() => expect(transition).toHaveBeenCalled())
  expect(logRecordNote).not.toHaveBeenCalled()
  expect(refresh).not.toHaveBeenCalled()
})
