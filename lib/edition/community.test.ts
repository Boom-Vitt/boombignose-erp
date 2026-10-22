import { expect, it, vi } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"
import { createElement } from "react"

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND") } }))
vi.mock("@/lib/supabase/server", () => ({ createClient: () => { throw new Error("Community integrations must not access Pro data") } }))
import { WorkspaceHeader, ClientPortalCard, AccountingIntegrationCard, InvoiceAccountingControls, InvoiceAccountingStatus, getInvoiceAccounting, PortalPage, AccountingSettingsPage } from "@edition"

it("Community shows its organization without querying or offering other workspaces", () => {
  const html = renderToStaticMarkup(createElement(WorkspaceHeader, { context: {
    userId: "actor", email: null, orgId: "org", orgName: "Community workspace", role: "owner",
  } }))
  expect(html).toContain("Community workspace")
  expect(html).not.toContain("Switch workspace")
})
it("Community renders no Pro cards or controls and performs no accounting query", async () => {
  expect(renderToStaticMarkup(createElement(ClientPortalCard, { clientId: "client" }))).toBe("")
  expect(renderToStaticMarkup(createElement(AccountingIntegrationCard))).toBe("")
  expect(renderToStaticMarkup(createElement(InvoiceAccountingControls, { invoiceId: "invoice", connected: false }))).toBe("")
  expect(renderToStaticMarkup(createElement(InvoiceAccountingStatus, { sync: null }))).toBe("")
  expect(await getInvoiceAccounting("org", "invoice")).toEqual({ connected: false, sync: null })
})
it("Community portal and accounting-settings routes are unavailable", () => {
  expect(() => renderToStaticMarkup(createElement(PortalPage, { params: Promise.resolve({ token: "token" }) }))).toThrow("NOT_FOUND")
  expect(AccountingSettingsPage).toThrow("NOT_FOUND")
})
