import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { afterEach, expect, it, vi } from "vitest"

import { onBeforeUnload, onLinkClick, recordGuard, RequireSaved } from "@/components/record/record-guard"

class FakeElement {
  constructor(private attributes: Record<string, string>) {}
  closest() { return this }
  getAttribute(name: string) { return this.attributes[name] ?? null }
  hasAttribute(name: string) { return name in this.attributes }
}
vi.stubGlobal("Element", FakeElement)

function click(href: string) {
  return {
    defaultPrevented: false, target: new FakeElement({ href }),
    button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false,
    preventDefault: vi.fn(), stopPropagation: vi.fn(),
  }
}
function leave(href: string, answer: boolean) {
  const confirm = vi.fn(() => answer)
  vi.stubGlobal("window", { confirm, location: { href: "https://erp.example/quotes/q1" } })
  const event = click(href)
  onLinkClick(event as unknown as MouseEvent)
  return { confirm, event }
}

afterEach(() => recordGuard.setForm("header", null))

it("lets links through while nothing is unsaved", () => {
  const { confirm, event } = leave("/quotes", false)
  expect(confirm).not.toHaveBeenCalled()
  expect(event.preventDefault).not.toHaveBeenCalled()
})

it("keeps the user on the page when they decline to discard unsaved edits", () => {
  recordGuard.setForm("header", { dirty: true, save: async () => true })
  const { confirm, event } = leave("/quotes", false)
  expect(confirm).toHaveBeenCalledOnce()
  expect(event.preventDefault).toHaveBeenCalled()
  expect(event.stopPropagation).toHaveBeenCalled()
  expect(recordGuard.snapshot().dirty).toBe(true)
})

it("discards and follows the link when the user confirms, without a second browser prompt", () => {
  recordGuard.setForm("header", { dirty: true, save: async () => true })
  const { event } = leave("/quotes", true)
  expect(event.preventDefault).not.toHaveBeenCalled()
  const unload = { preventDefault: vi.fn(), returnValue: undefined as unknown }
  onBeforeUnload(unload as unknown as BeforeUnloadEvent)
  expect(unload.preventDefault).not.toHaveBeenCalled()
})

it("does not ask for an anchor on the same page", () => {
  recordGuard.setForm("header", { dirty: true, save: async () => true })
  expect(leave("#lines", false).confirm).not.toHaveBeenCalled()
})

it("asks the browser to confirm closing or reloading with unsaved edits", () => {
  recordGuard.setForm("header", { dirty: true, save: async () => true })
  const unload = { preventDefault: vi.fn(), returnValue: undefined as unknown }
  onBeforeUnload(unload as unknown as BeforeUnloadEvent)
  expect(unload.preventDefault).toHaveBeenCalled()
})

it("holds an action that pins the saved version until the edits are saved, and says why", () => {
  const region = () => renderToStaticMarkup(createElement(RequireSaved, { message: "Save your invoice changes first." } as Parameters<typeof RequireSaved>[0], createElement("button", null, "Issue")))
  expect(region()).not.toContain("Save your invoice changes first.")
  expect(region()).not.toMatch(/<fieldset[^>]*disabled/)
  recordGuard.setForm("header", { dirty: true, save: async () => true })
  expect(region()).toContain("Save your invoice changes first.")
  expect(region()).toMatch(/<fieldset[^>]*disabled/)
})
