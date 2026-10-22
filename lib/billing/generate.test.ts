import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { Database } from "@/lib/types/database"
import * as billing from "./generate"

const subId = "11111111-1111-4111-8111-111111111111"
const orgId = "22222222-2222-4222-8222-222222222222"
const invoiceId = "33333333-3333-4333-8333-333333333333"

describe("subscription display number", () => {
  it("uses immutable subscription identity and the full scheduled date", () => {
    expect(billing.invoiceNumberFor(subId, "2026-07-02")).toBe("SUB-11111111-1111-4111-8111-111111111111-20260702")
  })
  it("keeps weekly occurrences within one month distinct", () => {
    expect(billing.invoiceNumberFor(subId, "2026-07-02")).not.toBe(billing.invoiceNumberFor(subId, "2026-07-09"))
  })
})

describe("subscription occurrence command", () => {
  it("bills the scheduled date through one transaction without issuing client writes", async () => {
    const requests: { url: string; body: unknown }[] = []
    const client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async (url, init) => {
        requests.push({ url: String(url), body: JSON.parse(String(init?.body)) })
        return Response.json(invoiceId)
      } },
    })
    expect(await billing.generateSubscriptionOccurrence(client, orgId, subId, "2026-07-02")).toBe(invoiceId)
    expect(requests).toEqual([{ url: "http://127.0.0.1:55501/rest/v1/rpc/generate_subscription_occurrence", body: { p_org_id: orgId, p_subscription_id: subId, p_occurrence: "2026-07-02" } }])
  })
  it("does not convert a rejected command to benign duplicate success", async () => {
    const client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => Response.json({ code: "23505", message: "invoice display number conflict", details: null, hint: null }, { status: 400 }) },
    })
    await expect(billing.generateSubscriptionOccurrence(client, orgId, subId, "2026-07-02")).rejects.toThrow("invoice display number conflict")
  })
  it("returns the seed invoice id although it lacks RFC 9562 version bits", async () => {
    const seedInvoice = "f0000000-0000-0000-0000-000000000001"
    const client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: async () => Response.json(seedInvoice) },
    })
    expect(await billing.generateSubscriptionOccurrence(client, "a0000000-0000-0000-0000-000000000001", "80000000-0000-0000-0000-000000000001", "2026-07-02")).toBe(seedInvoice)
  })
})
