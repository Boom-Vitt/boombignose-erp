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
