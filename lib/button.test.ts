import { createElement, type ComponentProps } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
import { Button } from "@/components/ui/button"

function linkButton(disabled: boolean) {
  let rendered: ComponentProps<"a"> = {}
  const Anchor = (props: ComponentProps<"a">) => { rendered = props; return createElement("a", props) }
  const onClick = vi.fn()
  const html = renderToStaticMarkup(createElement(Button, { disabled, onClick, render: createElement(Anchor, { href: "/deals" }) }, "Open"))
  const event = { preventDefault: vi.fn() }
  rendered.onClick?.(event as never)
  return { html, onClick, prevented: event.preventDefault }
}

it("keeps an enabled link button focusable and clickable", () => {
  const { html, onClick, prevented } = linkButton(false)
  expect(html).toContain('href="/deals"')
  expect(html).not.toContain("aria-disabled=")
  expect(html).not.toContain("tabindex=")
  expect(onClick).toHaveBeenCalledOnce()
  expect(prevented).not.toHaveBeenCalled()
})

it("takes a disabled link button out of the tab order and blocks activation", () => {
  const { html, onClick, prevented } = linkButton(true)
  expect(html).toContain('aria-disabled="true"')
  expect(html).toContain('tabindex="-1"')
  expect(onClick).not.toHaveBeenCalled()
  expect(prevented).toHaveBeenCalledOnce()
})
