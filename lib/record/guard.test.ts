import { describe, expect, it, vi } from "vitest"

import { createRecordGuard, leavesPage } from "./guard"

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

describe("record guard", () => {
  it("saves dirty header edits before the action runs", async () => {
    const guard = createRecordGuard()
    const calls: string[] = []
    guard.setForm("header", { dirty: true, save: async () => { calls.push("save"); return true } })
    guard.setForm("other", { dirty: false, save: async () => { calls.push("clean save"); return true } })
    expect(guard.snapshot().dirty).toBe(true)
    expect(await guard.run(async () => { calls.push("action") })).toBe("done")
    expect(calls).toEqual(["save", "action"])
  })

  it("stops the action when the pending edits cannot be saved", async () => {
    const guard = createRecordGuard()
    const action = vi.fn()
    guard.setForm("header", { dirty: true, save: async () => false })
    expect(await guard.run(action)).toBe("unsaved")
    expect(action).not.toHaveBeenCalled()
    expect(guard.snapshot().busy).toBe(false)
  })

  it("saves an editor that becomes dirty while an earlier editor is saving", async () => {
    const guard = createRecordGuard()
    const pending = deferred()
    const header = vi.fn(async () => true)
    guard.setForm("lines", { dirty: true, save: async () => { await pending.promise; return true } })
    guard.setForm("header", { dirty: false, save: header })
    const run = guard.run(vi.fn())
    guard.setForm("header", { dirty: true, save: header })
    pending.resolve()
    expect(await run).toBe("done")
    expect(header).toHaveBeenCalledOnce()
  })

  it("stops when an already saved editor changes while a later editor is saving", async () => {
    const guard = createRecordGuard()
    const pending = deferred()
    const header = vi.fn(async () => { await pending.promise; return true })
    const action = vi.fn()
    guard.setForm("lines", { dirty: true, save: async () => true })
    guard.setForm("header", { dirty: true, save: header })
    const run = guard.run(action)
    await vi.waitFor(() => expect(header).toHaveBeenCalledOnce())
    guard.setForm("lines", { dirty: true, save: async () => true })
    pending.resolve()
    expect(await run).toBe("unsaved")
    expect(action).not.toHaveBeenCalled()
    expect(guard.snapshot()).toMatchObject({ dirty: true, acting: false })
  })

  it("locks every guarded action while one is pending", async () => {
    const guard = createRecordGuard()
    const listener = vi.fn()
    guard.subscribe(listener)
    const pending = deferred()
    const first = guard.run(() => pending.promise)
    expect(guard.snapshot().busy).toBe(true)
    expect(listener).toHaveBeenCalled()
    const second = vi.fn()
    expect(await guard.run(second)).toBe("busy")
    expect(second).not.toHaveBeenCalled()
    pending.resolve()
    expect(await first).toBe("done")
    expect(guard.snapshot().busy).toBe(false)
  })

  it("stays locked until every holder has seen its refreshed page", async () => {
    const guard = createRecordGuard()
    guard.hold("status", true)
    expect(guard.snapshot().busy).toBe(true)
    expect(await guard.run(vi.fn())).toBe("busy")
    guard.hold("email", true)
    guard.hold("status", false)
    expect(guard.snapshot().busy).toBe(true)
    guard.hold("email", false)
    expect(guard.snapshot().busy).toBe(false)
    expect(await guard.run(async () => { guard.hold("status", true) })).toBe("done")
    expect(guard.snapshot().busy).toBe(true)
  })

  it("releases the lock when the action throws", async () => {
    const guard = createRecordGuard()
    await expect(guard.run(async () => { throw new Error("boom") })).rejects.toThrow("boom")
    expect(guard.snapshot().busy).toBe(false)
  })

  it("freezes record fields once the action itself runs, until its refreshed page renders", async () => {
    const guard = createRecordGuard()
    const saving = deferred()
    const acting = deferred()
    guard.setForm("header", { dirty: true, save: async () => { await saving.promise; return true } })
    const run = guard.run(() => acting.promise, "accept")
    // The transition's hold lands after run() starts, as React commits its pending state.
    guard.hold("accept", true)
    // Edits typed during the pre-action save stay possible; the guard then refuses to run over them.
    expect(guard.snapshot()).toMatchObject({ busy: true, acting: false })
    saving.resolve()
    await vi.waitFor(() => expect(guard.snapshot().acting).toBe(true))
    acting.resolve()
    expect(await run).toBe("done")
    expect(guard.snapshot().acting).toBe(true)
    guard.hold("accept", false)
    expect(guard.snapshot()).toMatchObject({ busy: false, acting: false })
  })

  it("never freezes fields for an action that did not run", async () => {
    const guard = createRecordGuard()
    guard.setForm("header", { dirty: true, save: async () => false })
    const run = guard.run(vi.fn(), "accept")
    guard.hold("accept", true)
    expect(await run).toBe("unsaved")
    expect(guard.snapshot().acting).toBe(false)
    expect(await createRecordGuard().run(async () => {})).toBe("done")
  })

  it("is clean again once the dirty form is gone or discarded", () => {
    const guard = createRecordGuard()
    guard.setForm("header", { dirty: true, save: async () => true })
    guard.setForm("header", null)
    expect(guard.snapshot().dirty).toBe(false)
    guard.setForm("header", { dirty: true, save: async () => true })
    guard.discard()
    expect(guard.snapshot().dirty).toBe(false)
  })
})

describe("leavesPage", () => {
  const here = "https://erp.example/quotes/q1?tab=lines"
  const click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }

  it("asks for links that replace this page in the same tab", () => {
    expect(leavesPage({ href: "/quotes" }, click, here)).toBe(true)
    expect(leavesPage({ href: "https://erp.example/quotes/q1?tab=history" }, click, here)).toBe(true)
  })

  it("lets same-page anchors, new tabs, downloads and other sites through", () => {
    expect(leavesPage({ href: "#payments" }, click, here)).toBe(false)
    expect(leavesPage({ href: "/quotes/q1?tab=lines#items" }, click, here)).toBe(false)
    expect(leavesPage({ href: "/quotes/q1/pdf", target: "_blank" }, click, here)).toBe(false)
    expect(leavesPage({ href: "/quotes/q1/pdf", download: true }, click, here)).toBe(false)
    expect(leavesPage({ href: "/quotes" }, { ...click, metaKey: true }, here)).toBe(false)
    expect(leavesPage({ href: "/quotes" }, { ...click, button: 1 }, here)).toBe(false)
    // The browser's own unsaved-changes prompt covers full page loads to other sites.
    expect(leavesPage({ href: "https://other.example/" }, click, here)).toBe(false)
  })
})
