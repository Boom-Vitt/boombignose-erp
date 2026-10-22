import { renderToStaticMarkup } from "react-dom/server"
import { expect, it, vi } from "vitest"
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock("@/lib/record-history/actions", () => ({ logRecordNote: vi.fn() }))

import { StatusBar } from "@/components/record/status-bar"
import { recordGuard } from "@/components/record/record-guard"
import { DEAL_FLOW } from "@/lib/record/status"

const bar = () => renderToStaticMarkup(StatusBar({
  label: "Deal stage",
  flow: DEAL_FLOW,
  status: "proposal",
  transition: async () => ({}),
  commands: { create_project: "/projects/new" },
}))

it("disables the whole status bar while one record action is pending", async () => {
  expect(bar()).not.toMatch(/<fieldset[^>]*disabled/)
  let release!: () => void
  const pending = recordGuard.run(() => new Promise<void>((done) => { release = done }))
  const locked = bar()
  expect(locked).toMatch(/<fieldset[^>]*disabled/)
  expect(locked).toContain("Start negotiation")
  expect(locked).toContain("Mark won")
  expect(locked).toContain("Mark lost")
  release()
  await pending
  expect(bar()).not.toMatch(/<fieldset[^>]*disabled/)
})
