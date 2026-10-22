/** A header form on a record page. `save` resolves false when the edits were not saved. */
export type GuardedForm = { dirty: boolean; save: () => Promise<boolean> }
export type GuardState = { busy: boolean; dirty: boolean }
export type RunResult = "done" | "busy" | "unsaved"

/**
 * One page-wide lock for record actions (status moves, email, convert) plus the header forms
 * they depend on, so an action never runs against stale data or races another action.
 */
export function createRecordGuard() {
  const forms = new Map<string, GuardedForm>()
  const listeners = new Set<() => void>()
  let state: GuardState = { busy: false, dirty: false }

  function publish(next: Partial<GuardState>) {
    state = { ...state, ...next }
    for (const listener of listeners) listener()
  }
  function syncDirty() {
    const dirty = [...forms.values()].some((form) => form.dirty)
    if (dirty !== state.dirty) publish({ dirty })
  }

  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    snapshot: () => state,
    setForm(id: string, form: GuardedForm | null) {
      if (form) forms.set(id, form)
      else forms.delete(id)
      syncDirty()
    },
    /** The user chose to leave without saving. */
    discard() {
      for (const [id, form] of forms) forms.set(id, { ...form, dirty: false })
      syncDirty()
    },
    async run(action: () => Promise<unknown>): Promise<RunResult> {
      if (state.busy) return "busy"
      publish({ busy: true })
      try {
        for (const form of [...forms.values()]) {
          if (form.dirty && !(await form.save())) return "unsaved"
        }
        await action()
        return "done"
      } finally {
        publish({ busy: false })
      }
    },
  }
}

export type RecordGuard = ReturnType<typeof createRecordGuard>

type Click = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }

/**
 * Whether following a link replaces this page in the same tab, so unsaved edits would be lost.
 * Other sites are left to the browser's own beforeunload prompt.
 */
export function leavesPage(link: { href: string; target?: string; download?: boolean }, click: Click, current: string): boolean {
  if (click.button !== 0 || click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return false
  if (link.download || (link.target && link.target !== "_self")) return false
  const here = new URL(current)
  const next = new URL(link.href, here)
  return next.origin === here.origin && (next.pathname !== here.pathname || next.search !== here.search)
}
