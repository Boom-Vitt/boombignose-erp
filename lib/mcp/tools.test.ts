import { describe, expect, it } from "vitest"
import { subscriptionMrr } from "@/lib/metrics/finance"
import { createFakeDataLayer, formatTHB } from "./data.mjs"
import { createErpMcpServer, createSecretRedactor } from "./erp-server.mjs"
import { MAX_LIMIT, parsePagination, resolveOrg, runTool } from "./tools.mjs"

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const ORG_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
const ORG_UNKNOWN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
const NOW = new Date("2026-10-15T05:00:00Z")
const baht = (n: number) => n * 100

type Store = Parameters<typeof createFakeDataLayer>[0]
type Out = Record<string, unknown> & { items: Array<Record<string, unknown>> }

const orgs = [
  { id: ORG_A, name: "Alpha Co", slug: "alpha" },
  { id: ORG_B, name: "Beta Co", slug: "beta" },
]

function run(name: string, args: Record<string, unknown>, store: Store) {
  const dataLayer = createFakeDataLayer({ organizations: orgs, ...store })
  return {
    dataLayer,
    result: runTool(name, args, { dataLayer, now: NOW }) as Promise<Out>,
  }
}

describe("pagination", () => {
  it("defaults, and clamps a large limit to the max", () => {
    expect(parsePagination()).toEqual({ limit: 50, offset: 0 })
    expect(parsePagination({ limit: null, offset: null })).toEqual({ limit: 50, offset: 0 })
    expect(parsePagination({ limit: 5000, offset: 7 })).toEqual({ limit: MAX_LIMIT, offset: 7 })
  })

  it("refuses a limit or offset that is not a whole number in range", () => {
    for (const limit of [0, -1, 1.5, "abc", Number.NaN]) {
      expect(() => parsePagination({ limit })).toThrow("limit must be a positive integer")
    }
    for (const offset of [-1, 0.5, "x"]) {
      expect(() => parsePagination({ offset })).toThrow("offset must be a non-negative integer")
    }
  })

  it("a bad page is refused before any tenant query", async () => {
    const { dataLayer, result } = run("list_clients", { org_id: ORG_A, limit: 0 }, {})
    await expect(result).rejects.toThrow("limit must be a positive integer")
    expect(dataLayer.queries.filter((q) => q.table !== "organizations")).toEqual([])
  })

  it("an offset past the end is an empty last page", async () => {
    const clients = [1, 2, 3].map((i) => ({ id: `c${i}`, org_id: ORG_A, name: `C${i}` }))
    const out = await run("list_clients", { org_id: ORG_A, limit: 2, offset: 2 }, { clients }).result
    expect(out).toMatchObject({ total: 3, limit: 2, offset: 2, has_more: false })
    expect(out.items).toHaveLength(1)
    const past = await run("list_clients", { org_id: ORG_A, offset: 10 }, { clients }).result
    expect(past).toMatchObject({ items: [], total: 3, has_more: false })
  })

  it("list_workspaces pages organizations without an org", async () => {
    const out = await run("list_workspaces", { limit: 1 }, {}).result
    expect(out).toEqual({ items: [orgs[0]], total: 2, limit: 1, offset: 0, has_more: true })
  })
})

describe("organization resolution", () => {
  const layer = (rows = orgs) => createFakeDataLayer({ organizations: rows })

  it("uses ERP_ORG_ID when no org_id is given, and an explicit org_id over it", async () => {
    await expect(resolveOrg({}, layer(), { erpOrgId: ` ${ORG_B} ` })).resolves.toMatchObject({ id: ORG_B })
    await expect(resolveOrg({ org_id: ` ${ORG_A}` }, layer(), { erpOrgId: ORG_B })).resolves.toMatchObject({
      id: ORG_A,
    })
    await expect(resolveOrg({ org_id: "  " }, layer(), { erpOrgId: ORG_B })).resolves.toMatchObject({
      id: ORG_B,
    })
  })

  it("an unknown ERP_ORG_ID or an empty ERP is an error", async () => {
    await expect(resolveOrg({}, layer(), { erpOrgId: ORG_UNKNOWN })).rejects.toThrow("Unknown organization")
    await expect(resolveOrg({}, layer([]))).rejects.toThrow("No organizations found in ERP")
  })

  it("an unknown tool fails after the org check, with no tenant query", async () => {
    const { dataLayer, result } = run("drop_tables", { org_id: ORG_A }, {})
    await expect(result).rejects.toThrow("Unknown tool: drop_tables")
    expect(dataLayer.queries.every((q) => q.table === "organizations")).toBe(true)
  })
})

describe("list tools", () => {
  it("list_projects keeps a missing budget as null, not ฿0.00", async () => {
    const projects = [
      { id: "p1", org_id: ORG_A, name: "No budget", budget_satang: null },
      { id: "p2", org_id: ORG_A, name: "Budgeted", budget_satang: "150050" },
    ]
    const out = await run("list_projects", { org_id: ORG_A }, { projects }).result
    expect(out.items).toEqual([
      { id: "p1", org_id: ORG_A, name: "No budget", budget_satang: null, budget_thb: null },
      { id: "p2", org_id: ORG_A, name: "Budgeted", budget_satang: 150050, budget_thb: "฿1,500.50" },
    ])
  })

  it("filters pass through to the scoped query, empty ones are dropped", async () => {
    const { dataLayer, result } = run(
      "list_payment_claims",
      { org_id: ORG_A, status: "pending", client_id: "", invoice_id: "inv-1" },
      {}
    )
    await result
    expect(dataLayer.queries.at(-1)).toMatchObject({
      table: "payment_claims",
      orgId: ORG_A,
      filters: { status: "pending", invoice_id: "inv-1" },
    })
  })

  it("an unsafe money value is an error, not a rounded number", async () => {
    const deals = [{ id: "d1", org_id: ORG_A, stage: "lead", value_satang: 2 ** 60 }]
    await expect(run("list_deals", { org_id: ORG_A }, { deals }).result).rejects.toThrow(
      "Money value outside safe satang bounds"
    )
  })
})

describe("finance_summary totals", () => {
  it("counts only open quotes, open deals and pending claims", async () => {
    const out = await run(
      "finance_summary",
      { org_id: ORG_A },
      {
        quotes: ["draft", "sent", "accepted", "declined", "expired", "converted"].map((status, i) => ({
          id: `q${i}`,
          org_id: ORG_A,
          status,
          total_satang: baht(1_000),
        })),
        deals: ["lead", "proposal", "won", "lost"].map((stage, i) => ({
          id: `d${i}`,
          org_id: ORG_A,
          stage,
          value_satang: baht(2_000),
        })),
        payment_claims: ["pending", "pending", "verified", "rejected"].map((status, i) => ({
          id: `pc${i}`,
          org_id: ORG_A,
          status,
          amount_satang: baht(300),
        })),
        // Another org's open records never count.
        invoices: [{ id: "ib", org_id: ORG_B, status: "sent", amount_satang: baht(9_999) }],
      }
    ).result
    expect(out).toMatchObject({
      open_quotes_count: 3,
      open_quotes_satang: baht(3_000),
      pipeline_satang: baht(4_000),
      pending_claims_count: 2,
      pending_claims_satang: baht(600),
      pending_claims_thb: formatTHB(baht(600)),
      invoiced_total_satang: 0,
    })
  })

  it("an empty workspace is all zeros with THB strings", async () => {
    const out = await run("finance_summary", { org_id: ORG_A }, {}).result
    expect(out.cash_balance_thb).toBe("฿0.00")
    expect(out.monthly_burn_satang).toBe(0)
    expect(out.unpaid_invoice_count).toBe(0)
    expect(out.mrr_thb).toBe("฿0.00")
  })

  it("MRR normalises every interval and rounds once, like the dashboard", async () => {
    const subscriptions = [
      { id: "s1", org_id: ORG_A, status: "active", amount_satang: 1_001, interval: "weekly" },
      { id: "s2", org_id: ORG_A, status: "active", amount_satang: 3_001, interval: "quarterly" },
      { id: "s3", org_id: ORG_A, status: "active", amount_satang: 12_007, interval: "yearly" },
      { id: "s4", org_id: ORG_A, status: "cancelled", amount_satang: 99_999, interval: "monthly" },
    ]
    const out = await run("finance_summary", { org_id: ORG_A }, { subscriptions }).result
    expect(out.mrr_satang).toBe(subscriptionMrr(subscriptions as Parameters<typeof subscriptionMrr>[0]))
    // (1001*52 + 3001*4 + 12007) / 12 = 6338.58 -> 6339
    expect(out.mrr_satang).toBe(6_339)
  })
})

describe("JSON-RPC boundary", () => {
  const server = () =>
    createErpMcpServer({ dataLayer: createFakeDataLayer({ organizations: orgs }), erpOrgId: ORG_A, now: NOW })
  const call = (msg: unknown) => server().handleMessage(msg) as Promise<{ result?: Record<string, unknown>; error?: unknown } | null>

  it("rejects malformed requests", async () => {
    for (const bad of [null, [], "x", { jsonrpc: "1.0", id: 1, method: "ping" }, { jsonrpc: "2.0", id: 1 }]) {
      expect((await call(bad))?.error).toEqual({ code: -32600, message: "Invalid Request" })
    }
    expect(await server().handleLine("{not json")).toBe(
      JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } })
    )
    expect(await server().handleLine("   ")).toBeNull()
  })

  it("answers nothing to a notification, even one naming a tool", async () => {
    expect(await call({ jsonrpc: "2.0", method: "tools/call", params: { name: "finance_summary" } })).toBeNull()
    expect(await call({ jsonrpc: "2.0", id: 1, method: "notifications/cancelled" })).toBeNull()
  })

  it("falls back to a supported protocol version", async () => {
    const res = await call({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "1999-01-01" } })
    expect(res?.result?.protocolVersion).toBe("2025-06-18")
  })

  it("validates tools/list and tools/call params", async () => {
    const bad = [
      [{ method: "tools/list", params: [] }, "Invalid params"],
      [{ method: "tools/list", params: { cursor: "next" } }, "Invalid pagination cursor"],
      [{ method: "tools/call" }, "Invalid params: expected object"],
      [{ method: "tools/call", params: { name: "" } }, "Invalid params: missing tool name"],
      [{ method: "tools/call", params: { name: "list_clients", arguments: null } }, "Invalid params: arguments must be an object"],
      [{ method: "tools/call", params: { name: "list_clients", arguments: ["x"] } }, "Invalid params: arguments must be an object"],
    ] as const
    for (const [msg, message] of bad) {
      expect((await call({ jsonrpc: "2.0", id: 1, ...msg }))?.error).toEqual({ code: -32602, message })
    }
  })

  it("an unknown tool or method is refused", async () => {
    const tool = await call({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "delete_client" } })
    expect(tool?.result).toEqual({ content: [{ type: "text", text: "Unknown tool: delete_client" }], isError: true })
    const method = await call({ jsonrpc: "2.0", id: "a", method: "resources/list" })
    expect(method).toEqual({ jsonrpc: "2.0", id: "a", error: { code: -32601, message: "Method not found: resources/list" } })
  })

  it("a tool error is a tool result, not a protocol error", async () => {
    const res = await call({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "list_clients", arguments: { limit: -1 } },
    })
    expect(res?.error).toBeUndefined()
    expect(res?.result).toEqual({ content: [{ type: "text", text: "limit must be a positive integer" }], isError: true })
  })
})

describe("secret redactor", () => {
  it("redacts registered secrets and their JSON-escaped form, ignoring short values", () => {
    const { register, redact } = createSecretRedactor(["abc", "  secret-value-1  "])
    register('quo"te\\secret')
    register(undefined)
    expect(redact("abc secret-value-1")).toBe("abc [REDACTED]")
    expect(redact(JSON.stringify({ k: 'quo"te\\secret' }))).toBe('{"k":"[REDACTED]"}')
  })

  it("redacts the longer of two overlapping secrets whole", () => {
    const { redact } = createSecretRedactor(["token-123", "token-123-extended"])
    expect(redact("x token-123-extended y")).toBe("x [REDACTED] y")
  })
})
