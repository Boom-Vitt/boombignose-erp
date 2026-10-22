import { beforeEach, expect, it, vi } from "vitest"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"

const state = vi.hoisted(() => ({ client: {} as unknown }))
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => state.client }))
import { getInvoiceAccounting } from "./invoice-sync"

beforeEach(() => {
  state.client = databaseFixture({
    accounting_connections: [
      { org_id: "B", provider: "xero", status: "connected" },
      { org_id: "A", provider: "peak", status: "connected" },
    ],
    accounting_sync_map: [
      { org_id: "B", local_id: "invoice-A", local_entity: "invoice", external_id: "PRIVATE_B" },
      { org_id: "A", local_id: "invoice-A", local_entity: "project", external_id: "WRONG_ENTITY" },
      { org_id: "A", local_id: "invoice-B", local_entity: "invoice", external_id: "WRONG_INVOICE" },
      { org_id: "A", local_id: "invoice-A", local_entity: "invoice", external_id: "PUBLIC_A", provider: "peak" },
    ],
  })
})

it("invoice sync reads remain scoped to the active org, invoice, and entity", async () => {
  const result = await getInvoiceAccounting("A", "invoice-A")
  expect(result.connected).toBe(true)
  expect(result.sync?.external_id).toBe("PUBLIC_A")
})

it("an org with no connection or mapping stays disconnected", async () => {
  expect(await getInvoiceAccounting("C", "invoice-A")).toEqual({ connected: false, sync: null })
})
