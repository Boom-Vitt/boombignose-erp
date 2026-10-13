import { createClient } from "@supabase/supabase-js"
import { describe, expect, it } from "vitest"

import type { Database } from "@/lib/types/database"
import { dispatchReminders } from "./dispatch"

const spec = { entity: "deal" as const, entityId: "11111111-1111-4111-8111-111111111111", title: "Call client", dueDate: "2026-10-13" }
const orgId = "22222222-2222-4222-8222-222222222222"

function clientWith(response: unknown, status = 200) {
  const requests: { url: string; body: unknown }[] = []
  const client = createClient<Database>("http://127.0.0.1:55501", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (url, init) => {
      requests.push({ url: String(url), body: JSON.parse(String(init?.body ?? "null")) })
      return Response.json(String(url).includes("/rpc/") || status !== 200 ? response : [], { status })
    } },
  })
  return { client, requests }
}

describe("dispatchReminders atomic boundary", () => {
  it("sends one command for reminder and event creation, including orphan recovery", async () => {
    const { client, requests } = clientWith({ remindersUpserted: 0, eventsQueued: 1 })
    expect(await dispatchReminders(client, orgId, [spec])).toEqual({ remindersUpserted: 0, eventsQueued: 1 })
    expect(requests).toEqual([{ url: "http://127.0.0.1:55501/rest/v1/rpc/enqueue_reminders", body: { p_org_id: orgId, p_specs: [spec] } }])
  })

  it("propagates a failed transaction instead of reporting partial success", async () => {
    const { client } = clientWith({ code: "23503", message: "wrong tenant source", details: null, hint: null }, 400)
    await expect(dispatchReminders(client, orgId, [spec])).rejects.toThrow("wrong tenant source")
  })

  it("rejects malformed transaction counts", async () => {
    const { client } = clientWith({ remindersUpserted: -1, eventsQueued: 1 })
    await expect(dispatchReminders(client, orgId, [spec])).rejects.toThrow("Invalid reminder command result")
  })

  it("does no I/O when there are no due items", async () => {
    const { client, requests } = clientWith(null)
    expect(await dispatchReminders(client, orgId, [])).toEqual({ remindersUpserted: 0, eventsQueued: 0 })
    expect(requests).toEqual([])
  })
})
