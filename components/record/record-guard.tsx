"use client"

import { useCallback, useEffect, useId, useSyncExternalStore, type ReactNode } from "react"
import type { FieldValues, UseFormReturn } from "react-hook-form"
import { toast } from "sonner"

import { createRecordGuard, leavesPage } from "@/lib/record/guard"
import { cn } from "@/lib/utils"

/** One per tab: a page shows one record, and navigation replaces its forms. */
export const recordGuard = createRecordGuard()

const LEAVE_PROMPT = "You have unsaved changes. Leave this page and discard them?"

export function onBeforeUnload(event: BeforeUnloadEvent) {
  if (!recordGuard.snapshot().dirty) return
  event.preventDefault()
  event.returnValue = ""
}

// Capture runs before Next's <Link> handler, so cancelling here keeps the user on the page.
export function onLinkClick(event: MouseEvent) {
  if (event.defaultPrevented || !recordGuard.snapshot().dirty || !(event.target instanceof Element)) return
  const link = event.target.closest("a[href]")
  const href = link?.getAttribute("href")
  if (!link || !href) return
  const target = { href, target: link.getAttribute("target") ?? undefined, download: link.hasAttribute("download") }
  if (!leavesPage(target, event, window.location.href)) return
  if (window.confirm(LEAVE_PROMPT)) {
    recordGuard.discard()
    return
  }
  event.preventDefault()
  event.stopPropagation()
}

let leaveGuardInstalled = false
function installLeaveGuard() {
  if (leaveGuardInstalled) return
  leaveGuardInstalled = true
  window.addEventListener("beforeunload", onBeforeUnload)
  document.addEventListener("click", onLinkClick, true)
}

export function useRecordGuard() {
  // The server never runs an action, so its snapshot is the same idle state.
  const state = useSyncExternalStore(recordGuard.subscribe, recordGuard.snapshot, recordGuard.snapshot)
  const run = useCallback(async (action: () => Promise<unknown>): Promise<void> => {
    const result = await recordGuard.run(action)
    if (result === "unsaved") toast.error("Nothing ran because your changes could not be saved. Fix them and try again.")
  }, [])
  return { ...state, run }
}

/**
 * Registers a record's header form: record actions save it first, and leaving with unsaved
 * edits asks first. `onValid` returns true once saved; the form is then clean again.
 * Returns the form's own submit handler.
 */
export function useGuardedForm<V extends FieldValues, O>(
  form: UseFormReturn<V, unknown, O>,
  onValid: (values: O) => Promise<boolean | void>
) {
  const id = useId()
  const dirty = form.formState.isDirty
  async function commit(values: O) {
    const saved = (await onValid(values)) === true
    if (saved) form.reset(form.getValues())
    return saved
  }
  // Re-registers after every render so the guard always saves with the latest handler.
  useEffect(() => {
    recordGuard.setForm(id, {
      dirty,
      save: () => new Promise<boolean>((resolve, reject) => {
        form.handleSubmit(async (values) => resolve(await commit(values)), () => resolve(false))().catch(reject)
      }),
    })
    installLeaveGuard()
  })
  useEffect(() => () => recordGuard.setForm(id, null), [id])
  return form.handleSubmit(async (values) => {
    await commit(values)
  })
}

/** Record action buttons, all disabled while any record action runs. */
export function RecordActionGroup({ className, children }: { className?: string; children: ReactNode }) {
  const { busy } = useRecordGuard()
  return (
    <fieldset disabled={busy} aria-busy={busy} className={cn("min-w-0", className)}>
      {children}
    </fieldset>
  )
}

/** Wraps an action that cannot save the header first (it pins the saved version), so it waits for a save. */
export function RequireSaved({ message, children }: { message: string; children: ReactNode }) {
  const { busy, dirty } = useRecordGuard()
  return (
    <fieldset disabled={busy || dirty} className="min-w-0 space-y-2">
      {dirty ? <p role="status" className="text-sm text-amber-700 dark:text-amber-400">{message}</p> : null}
      {children}
    </fieldset>
  )
}
