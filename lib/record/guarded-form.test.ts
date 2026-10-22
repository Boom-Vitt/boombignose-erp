import { expect, it, vi } from "vitest"
import { createFormControl, type FormState, type UseFormReturn } from "react-hook-form"

// GuardedHeader is called as a function component; transitions and effects run at once.
vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useTransition: () => [false, (task: () => unknown) => { void task() }],
  useId: () => "header",
  useEffect: (effect: () => unknown) => { effect() },
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }))

import { recordGuard, useGuardedForm } from "@/components/record/record-guard"

type Header = { title: string; meta: { notes: string } }

vi.stubGlobal("window", { addEventListener: vi.fn() })
vi.stubGlobal("document", { addEventListener: vi.fn() })

function GuardedHeader({ form, onValid }: { form: UseFormReturn<Header>; onValid: () => Promise<boolean> }) {
  return useGuardedForm(form, onValid)
}

function mountHeader() {
  const control = createFormControl<Header>({ defaultValues: { title: "Old", meta: { notes: "" } } })
  let state = {} as Partial<FormState<Header>>
  control.subscribe({ formState: { isDirty: true, dirtyFields: true, defaultValues: true }, callback: (next) => { state = next } })
  const form = { ...control, get formState() { return state } } as unknown as UseFormReturn<Header>
  let finish: ((saved: boolean) => void) | undefined
  const render = () => GuardedHeader({ form, onValid: () => new Promise<boolean>((resolve) => { finish = resolve }) })
  const inFlight = async () => { await vi.waitFor(() => expect(finish).toBeDefined()); return finish! }
  return { control, submit: render(), render, state: () => state, inFlight }
}

it("keeps edits typed while the header save is pending, and keeps them dirty", async () => {
  const { control, submit, state, inFlight } = mountHeader()
  control.setValue("title", "Saved", { shouldDirty: true })
  const saving = submit()
  const finish = await inFlight()
  control.setValue("meta.notes", "Typed during save", { shouldDirty: true })
  finish(true)
  await saving

  expect(control.getValues()).toEqual({ title: "Saved", meta: { notes: "Typed during save" } })
  expect(state()).toMatchObject({ isDirty: true, defaultValues: { title: "Saved", meta: { notes: "" } } })
  expect(state().dirtyFields).toEqual({ meta: { notes: true } })
})

it("is clean against the saved values when nothing changed during the save", async () => {
  const { control, submit, state, inFlight } = mountHeader()
  control.setValue("title", "Saved", { shouldDirty: true })
  const saving = submit()
  ;(await inFlight())(true)
  await saving

  expect(control.getValues()).toEqual({ title: "Saved", meta: { notes: "" } })
  expect(state()).toMatchObject({ isDirty: false, defaultValues: { title: "Saved", meta: { notes: "" } } })
  expect(state().dirtyFields).toEqual({})
})

it("stops a record action while edits typed during its save are still unsaved", async () => {
  const { control, render, state, inFlight } = mountHeader()
  control.setValue("title", "Saved", { shouldDirty: true })
  render()
  const accept = vi.fn()
  const running = recordGuard.run(accept)
  const finish = await inFlight()
  control.setValue("meta.notes", "Typed during save", { shouldDirty: true })
  finish(true)

  expect(await running).toBe("unsaved")
  expect(accept).not.toHaveBeenCalled()
  expect(control.getValues()).toEqual({ title: "Saved", meta: { notes: "Typed during save" } })
  expect(state().dirtyFields).toEqual({ meta: { notes: true } })
})

it("runs the record action once its save leaves nothing unsaved", async () => {
  const { control, render, inFlight } = mountHeader()
  control.setValue("title", "Saved", { shouldDirty: true })
  render()
  const accept = vi.fn()
  const running = recordGuard.run(accept)
  ;(await inFlight())(true)

  expect(await running).toBe("done")
  expect(accept).toHaveBeenCalledOnce()
})
