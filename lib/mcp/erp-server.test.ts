import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { PassThrough } from "node:stream"
import { describe, expect, it, vi } from "vitest"
import { todayISO } from "@/lib/dates"
import { deriveInvoiceStatus } from "@/lib/metrics/invoice-status"
import {
  costsForMonth,
  subscriptionMrr,
  unpaidCount,
  unpaidTotal,
} from "@/lib/metrics/finance"
import {
  assertLocalSupabaseUrl,
  createFakeDataLayer,
  createSupabaseDataLayer,
  formatTHB,
} from "./data.mjs"
import {
  createErpMcpServer,
  DEFAULT_ERP_DIR,
  startStdioServer,
} from "./erp-server.mjs"
import { resolveOrg, runTool, TOOLS } from "./tools.mjs"

const ORG_A = "11111111-1111-4111-8111-111111111111"
const ORG_B = "22222222-2222-4222-8222-222222222222"
const ORG_UNKNOWN = "99999999-9999-4999-8999-999999999999"

type ToolCallResponse = {
  jsonrpc: string
  id: number | string | null
  result: {
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }
  error?: {
    code: number
    message: string
  }
}

type QueryBuilderMock = {
  select: (cols: string) => QueryBuilderMock
  eq: (col: string, val: string) => QueryBuilderMock
  order: () => QueryBuilderMock
  range: () => QueryBuilderMock
  then: (resolve: (v: unknown) => void) => void
}

function buildTwoOrgFixture() {
  const clientRowA = {
    id: "c1111111-1111-4111-8111-111111111111",
    org_id: ORG_A,
    name: "Somchai Jaidee (Sole Proprietor)",
    industry: "Consulting",
    source: "Referral",
    notes: "PRIVATE_CLIENT_NOTE_DO_NOT_LEAK",
    email: "somchai@private.example",
    phone: "+66812345678",
    billing_address: "123 Sukhumvit Rd",
    tax_id: "1234567890123",
    portal_token: ["ptok", "a".repeat(12)].join("-"),
    owner: "u1111111-1111-4111-8111-111111111111",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  }

  const clientRowB = {
    id: "c2222222-2222-4222-8222-222222222222",
    org_id: ORG_B,
    name: "Other Org Co Ltd",
    industry: "Retail",
    source: "Inbound",
    notes: "OTHER_ORG_SECRET_NOTE",
    email: "other@private.example",
    phone: "+66899999999",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-02T00:00:00Z",
  }

  return {
    organizations: [
      {
        id: ORG_A,
        name: "Alpha Workspace",
        slug: "alpha",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      {
        id: ORG_B,
        name: "Beta Workspace",
        slug: "beta",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
    ],
    clients: [clientRowA, clientRowB],
    deals: [
      {
        id: "d1111111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        client_id: clientRowA.id,
        title: "ERP Rollout",
        stage: "proposal",
        value_satang: 2500000,
        currency: "THB",
        expected_close_date: "2026-03-01",
        next_follow_up_date: "2026-02-15",
        source: "Referral",
        notes: "PRIVATE_DEAL_NOTE_DO_NOT_LEAK",
        owner: "u1111111-1111-4111-8111-111111111111",
        created_at: "2026-01-05T00:00:00Z",
        updated_at: "2026-01-06T00:00:00Z",
      },
      {
        id: "d2222222-2222-4222-8222-222222222222",
        org_id: ORG_B,
        client_id: clientRowB.id,
        title: "Beta Deal",
        stage: "lead",
        value_satang: 9900000,
        currency: "THB",
        notes: "BETA_DEAL_NOTE",
        created_at: "2026-01-05T00:00:00Z",
        updated_at: "2026-01-06T00:00:00Z",
      },
    ],
    quotes: [
      {
        id: "q1111111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        client_id: clientRowA.id,
        project_id: "p1111111-1111-4111-8111-111111111111",
        number: "QUO-2026-001",
        status: "sent",
        issue_date: "2026-01-10",
        valid_until: "2026-02-10",
        subtotal_satang: 3000000,
        discount_satang: 500000,
        total_satang: 2500000,
        notes: "PRIVATE_QUOTE_NOTE_DO_NOT_LEAK",
        converted_invoice_id: null,
        owner: "u1111111-1111-4111-8111-111111111111",
        created_at: "2026-01-10T00:00:00Z",
        updated_at: "2026-01-10T00:00:00Z",
      },
      {
        id: "q2222222-2222-4222-8222-222222222222",
        org_id: ORG_B,
        client_id: clientRowB.id,
        project_id: null,
        number: "QUO-2026-999",
        status: "draft",
        issue_date: "2026-01-10",
        valid_until: "2026-02-10",
        subtotal_satang: 8000000,
        discount_satang: 0,
        total_satang: 8000000,
        notes: "BETA_QUOTE_NOTE",
        created_at: "2026-01-10T00:00:00Z",
        updated_at: "2026-01-10T00:00:00Z",
      },
    ],
    projects: [
      {
        id: "p1111111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        deal_id: "d1111111-1111-4111-8111-111111111111",
        client_id: clientRowA.id,
        source_quote_id: "q1111111-1111-4111-8111-111111111111",
        name: "Alpha Implementation",
        status: "in_progress",
        deadline: "2026-04-01",
        budget_satang: 2500000,
        owner: "u1111111-1111-4111-8111-111111111111",
        notes: "PRIVATE_PROJECT_NOTE_DO_NOT_LEAK",
        created_at: "2026-01-12T00:00:00Z",
        updated_at: "2026-01-12T00:00:00Z",
      },
      {
        id: "p2222222-2222-4222-8222-222222222222",
        org_id: ORG_B,
        deal_id: null,
        client_id: clientRowB.id,
        source_quote_id: null,
        name: "Beta Project",
        status: "not_started",
        deadline: "2026-05-01",
        budget_satang: 4000000,
        created_at: "2026-01-12T00:00:00Z",
        updated_at: "2026-01-12T00:00:00Z",
      },
    ],
    invoices: [
      {
        id: "i1111111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        client_id: clientRowA.id,
        project_id: "p1111111-1111-4111-8111-111111111111",
        source_quote_id: "q1111111-1111-4111-8111-111111111111",
        source_milestone_id: null,
        number: "INV-2026-000001",
        status: "sent",
        issue_date: "2026-01-15",
        due_date: "2026-02-15",
        amount_satang: 2500000,
        discount_satang: 500000,
        is_recurring: false,
        recurring_interval: null,
        notes: "PRIVATE_INVOICE_NOTE_DO_NOT_LEAK",
        created_at: "2026-01-15T00:00:00Z",
        updated_at: "2026-01-15T00:00:00Z",
      },
      {
        id: "i2222222-2222-4222-8222-222222222222",
        org_id: ORG_B,
        client_id: clientRowB.id,
        project_id: null,
        source_quote_id: null,
        source_milestone_id: null,
        number: "INV-2026-000999",
        status: "sent",
        issue_date: "2026-01-15",
        due_date: "2026-02-15",
        amount_satang: 7700000,
        discount_satang: 0,
        is_recurring: false,
        recurring_interval: null,
        notes: "BETA_INVOICE_NOTE",
        created_at: "2026-01-15T00:00:00Z",
        updated_at: "2026-01-15T00:00:00Z",
      },
    ],
    payment_claims: [
      {
        id: "pc111111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        client_id: clientRowA.id,
        invoice_id: "i1111111-1111-4111-8111-111111111111",
        amount_satang: 1000000,
        reference: "SLIP-BANK-9988776655",
        review_reference: "BANK-STMT-REF-112233",
        status: "pending",
        source: "portal",
        idempotency_key: "ik-1",
        reviewed_by: "u1111111-1111-4111-8111-111111111111",
        submitted_by: "u1111111-1111-4111-8111-111111111111",
        reviewed_at: null,
        payment_id: null,
        created_at: "2026-01-16T00:00:00Z",
        updated_at: "2026-01-16T00:00:00Z",
      },
      {
        id: "pc222222-2222-4222-8222-222222222222",
        org_id: ORG_B,
        client_id: clientRowB.id,
        invoice_id: "i2222222-2222-4222-8222-222222222222",
        amount_satang: 7700000,
        reference: "BETA-SLIP-SECRET",
        status: "pending",
        source: "portal",
        created_at: "2026-01-16T00:00:00Z",
        updated_at: "2026-01-16T00:00:00Z",
      },
    ],
    org_settings: [
      {
        org_id: ORG_A,
        cash_balance_satang: 50000000,
        monthly_burn_satang: 12000000,
        legal_name: "Alpha Legal Co",
        business_address: "99 Bangkok Secret Address",
        tax_id: "9999999999999",
      },
    ],
    payments: [
      {
        id: "pay11111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        invoice_id: "i1111111-1111-4111-8111-111111111111",
        amount_satang: 500000,
        paid_at: "2026-01-18T00:00:00Z",
        method: "transfer",
        verification_state: "verified",
        verification_reference: "PRIVATE-BANK-EVIDENCE-REF",
        notes: "PRIVATE_PAYMENT_NOTE",
      },
    ],
    costs: [
      {
        id: "cost1111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        project_id: "p1111111-1111-4111-8111-111111111111",
        category: "software",
        amount_satang: 300000,
        incurred_on: "2026-01-19",
        vendor: "Cloud Vendor",
        notes: "PRIVATE_COST_NOTE",
      },
    ],
    subscriptions: [
      {
        id: "sub11111-1111-4111-8111-111111111111",
        org_id: ORG_A,
        client_id: clientRowA.id,
        name: "Alpha Retainer",
        amount_satang: 1500000,
        interval: "monthly",
        status: "active",
        notes: "PRIVATE_SUB_NOTE",
      },
    ],
  }
}

describe("ERP MCP server", () => {
  it("initialize and tools/list over stdio", async () => {
    const serverScript = path.join(DEFAULT_ERP_DIR, "lib", "mcp", "erp-server.mjs")
    const child = spawn(process.execPath, [serverScript], {
      cwd: DEFAULT_ERP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    })

    const stdoutLines: string[] = []
    const rl = createInterface({ input: child.stdout })
    rl.on("line", (line) => {
      stdoutLines.push(line)
    })

    const requests = [
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "bbn-test", version: "1.0.0" },
        },
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "ping",
      }),
      JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/list",
      }),
    ]

    for (const req of requests) {
      child.stdin.write(`${req}\n`)
    }
    child.stdin.end()

    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code))
    })

    expect(exitCode).toBe(0)
    expect(stdoutLines).toHaveLength(3)

    const initReply = JSON.parse(stdoutLines[0])
    expect(initReply).toMatchObject({
      jsonrpc: "2.0",
      id: 1,
      result: {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
      },
    })

    const pingReply = JSON.parse(stdoutLines[1])
    expect(pingReply).toEqual({
      jsonrpc: "2.0",
      id: 2,
      result: {},
    })

    const listReply = JSON.parse(stdoutLines[2])
    expect(listReply.id).toBe(3)
    const toolNames = listReply.result.tools.map((t: { name: string }) => t.name)
    expect(toolNames).toEqual([
      "list_workspaces",
      "list_clients",
      "list_deals",
      "list_quotes",
      "list_projects",
      "list_invoices",
      "list_payment_claims",
      "finance_summary",
    ])
  })

  it("every tool filters by org_id", async () => {
    const fakeData = createFakeDataLayer(buildTwoOrgFixture())
    const server = createErpMcpServer({ dataLayer: fakeData })

    const orgScopedTools = [
      "list_clients",
      "list_deals",
      "list_quotes",
      "list_projects",
      "list_invoices",
      "list_payment_claims",
      "finance_summary",
    ]

    // When two organizations exist and ERP_ORG_ID is unset, omitting org_id fails.
    for (const toolName of orgScopedTools) {
      const missingOrgRes = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 10,
        method: "tools/call",
        params: { name: toolName, arguments: {} },
      })) as unknown as ToolCallResponse
      expect(missingOrgRes.result.isError).toBe(true)
      expect(missingOrgRes.result.content[0].text).toMatch(/org_id is required/i)
    }

    // Passing org_id scopes every single query to ORG_A and never returns ORG_B data.
    for (const toolName of orgScopedTools) {
      fakeData.queries.length = 0
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 11,
        method: "tools/call",
        params: { name: toolName, arguments: { org_id: ORG_A } },
      })) as unknown as ToolCallResponse

      expect(res.result.isError).toBeUndefined()
      const text = res.result.content[0].text
      expect(text).not.toContain(ORG_B)
      expect(text).not.toContain("Other Org Co Ltd")
      expect(text).not.toContain("Beta Deal")
      expect(text).not.toContain("QUO-2026-999")
      expect(text).not.toContain("INV-2026-000999")

      const dataQueries = fakeData.queries.filter(
        (q) => q.table !== "organizations"
      )
      expect(dataQueries.length).toBeGreaterThan(0)
      for (const q of dataQueries) {
        expect(q.orgId).toBe(ORG_A)
      }
    }

    // Also verify createSupabaseDataLayer calls .eq("org_id", orgId) on the Supabase client.
    const eqCalls: Array<{ table: string; col: string; val: string; columns: string }> = []
    const mockSupabase = {
      from(table: string) {
        let selectedColumns = ""
        const builder: QueryBuilderMock = {
          select(cols: string) {
            selectedColumns = cols
            return builder
          },
          eq(col: string, val: string) {
            eqCalls.push({ table, col, val, columns: selectedColumns })
            return builder
          },
          order() {
            return builder
          },
          range() {
            return builder
          },
          then(resolve: (v: unknown) => void) {
            resolve({ data: [], error: null, count: 0 })
          },
        }
        return builder
      },
    }
    const supaLayer = createSupabaseDataLayer(mockSupabase)
    await supaLayer.listClients(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.listDeals(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.listQuotes(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.listProjects(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.listInvoices(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.listPaymentClaims(ORG_A, { limit: 10, offset: 0 })
    await supaLayer.getFinanceInputs(ORG_A)
    await supaLayer.getInvoiceInputs(ORG_A)

    expect(eqCalls.length).toBe(16)
    for (const call of eqCalls) {
      expect(call.col).toBe("org_id")
      expect(call.val).toBe(ORG_A)
      expect(call.columns).not.toContain("*")
    }
  })

  it("an unknown org is an error", async () => {
    const fakeData = createFakeDataLayer(buildTwoOrgFixture())
    const server = createErpMcpServer({ dataLayer: fakeData })

    for (const tool of TOOLS.filter((t) => t.name !== "list_workspaces")) {
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 20,
        method: "tools/call",
        params: { name: tool.name, arguments: { org_id: ORG_UNKNOWN } },
      })) as unknown as ToolCallResponse

      expect(res.result.isError).toBe(true)
      expect(res.result.content[0].text).toContain(
        `Unknown organization: ${ORG_UNKNOWN}`
      )
    }
  })

  it("tools never write", () => {
    const mcpDir = path.join(DEFAULT_ERP_DIR, "lib", "mcp")
    const sourceFiles = fs
      .readdirSync(mcpDir)
      .filter((f) => f.endsWith(".mjs") || (f.endsWith(".ts") && !f.endsWith(".test.ts")))

    expect(sourceFiles.length).toBeGreaterThanOrEqual(3)
    const forbiddenWritePattern = /\.\s*(insert|update|upsert|delete|rpc)\s*\(/

    for (const file of sourceFiles) {
      const content = fs.readFileSync(path.join(mcpDir, file), "utf8")
      expect(content).not.toMatch(forbiddenWritePattern)
      expect(content).not.toContain('.select("*")')
      expect(content).not.toContain(".select('*')")
    }
  })

  it("refuses a non-local Supabase URL", async () => {
    expect(() =>
      assertLocalSupabaseUrl("https://projectref.supabase.co")
    ).toThrow(/non-local/i)
    expect(() =>
      assertLocalSupabaseUrl("http://192.168.1.50:54421")
    ).toThrow(/non-local/i)
    expect(assertLocalSupabaseUrl("http://127.0.0.1:54421")).toBe(
      "http://127.0.0.1:54421"
    )
    expect(assertLocalSupabaseUrl("http://localhost:54421")).toBe(
      "http://localhost:54421"
    )

    const runtimeKey = ["srv", "local", "k".repeat(18)].join("_")
    const server = createErpMcpServer({
      erpDir: DEFAULT_ERP_DIR,
      execFileSyncImpl: () =>
        `API_URL="https://remote-cloud.supabase.co"\nSERVICE_ROLE_KEY="${runtimeKey}"\n`,
    })

    const res = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 30,
      method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    })) as unknown as ToolCallResponse

    expect(res.result.isError).toBe(true)
    expect(res.result.content[0].text).toMatch(/Refusing non-local Supabase URL/i)
    expect(res.result.content[0].text).not.toContain(runtimeKey)
  })

  it("never returns contact emails, phone numbers or notes", async () => {
    const fakeData = createFakeDataLayer(buildTwoOrgFixture())
    const server = createErpMcpServer({ dataLayer: fakeData })

    const allTools = TOOLS.map((t) => t.name)
    for (const toolName of allTools) {
      const args = toolName === "list_workspaces" ? {} : { org_id: ORG_A }
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 40,
        method: "tools/call",
        params: { name: toolName, arguments: args },
      })) as unknown as ToolCallResponse

      expect(res.result.isError).toBeUndefined()
      const rawText = res.result.content[0].text

      // Must never contain contact emails, phones, notes, bank references, addresses, tax IDs, or tokens
      expect(rawText).not.toContain("somchai@private.example")
      expect(rawText).not.toContain("+66812345678")
      expect(rawText).not.toContain("PRIVATE_CLIENT_NOTE_DO_NOT_LEAK")
      expect(rawText).not.toContain("PRIVATE_DEAL_NOTE_DO_NOT_LEAK")
      expect(rawText).not.toContain("PRIVATE_QUOTE_NOTE_DO_NOT_LEAK")
      expect(rawText).not.toContain("PRIVATE_PROJECT_NOTE_DO_NOT_LEAK")
      expect(rawText).not.toContain("PRIVATE_INVOICE_NOTE_DO_NOT_LEAK")
      expect(rawText).not.toContain("PRIVATE_PAYMENT_NOTE")
      expect(rawText).not.toContain("PRIVATE_COST_NOTE")
      expect(rawText).not.toContain("PRIVATE_SUB_NOTE")
      expect(rawText).not.toContain("SLIP-BANK-9988776655")
      expect(rawText).not.toContain("BANK-STMT-REF-112233")
      expect(rawText).not.toContain("PRIVATE-BANK-EVIDENCE-REF")
      expect(rawText).not.toContain("123 Sukhumvit Rd")
      expect(rawText).not.toContain("99 Bangkok Secret Address")
      expect(rawText).not.toContain("1234567890123")
      expect(rawText).not.toContain("ptok-")
      expect(rawText).not.toContain('"notes"')
      expect(rawText).not.toContain('"email"')
      expect(rawText).not.toContain('"phone"')
      expect(rawText).not.toContain('"reference"')
      expect(rawText).not.toContain('"review_reference"')
      expect(rawText).not.toContain('"portal_token"')
    }

    // Verify money fields carry both satang integer and formatted THB string
    const dealsRes = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 41,
      method: "tools/call",
      params: { name: "list_deals", arguments: { org_id: ORG_A } },
    })) as unknown as ToolCallResponse
    const dealsPayload = JSON.parse(dealsRes.result.content[0].text)
    expect(dealsPayload.items[0].value_satang).toBe(2500000)
    expect(dealsPayload.items[0].value_thb).toBe(formatTHB(2500000))
  })

  it("the service role key never appears in output or errors", async () => {
    const runtimeSecret = ["s", "r", "v", "z".repeat(22)].join("_")
    const logs: string[] = []

    const server = createErpMcpServer({
      erpDir: DEFAULT_ERP_DIR,
      onLog: (msg: string) => logs.push(msg),
      execFileSyncImpl: () =>
        `API_URL="http://127.0.0.1:54421"\nSERVICE_ROLE_KEY="${runtimeSecret}"\n`,
      supabaseClientFactory: (_url: string, key: string) => ({
        from() {
          const builder: QueryBuilderMock = {
            select() {
              return builder
            },
            order() {
              return builder
            },
            range() {
              return builder
            },
            eq() {
              return builder
            },
            then(resolve: (v: unknown) => void) {
              resolve({
                data: null,
                error: { message: `Auth failure with credential ${key}` },
              })
            },
          }
          return builder
        },
      }),
    })

    const res = (await server.handleMessage({
      jsonrpc: "2.0",
      id: 50,
      method: "tools/call",
      params: { name: "list_workspaces", arguments: {} },
    })) as unknown as ToolCallResponse

    expect(res.result.isError).toBe(true)
    const serialized = JSON.stringify(res)
    expect(serialized).not.toContain(runtimeSecret)
    expect(serialized).toContain("[REDACTED]")
    for (const logMsg of logs) {
      expect(logMsg).not.toContain(runtimeSecret)
    }
  })

  it("refuses an ERP_DIR without the boombignose-erp supabase config", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "erp-mcp-cfg-"))
    try {
      let cliCalled = false
      const serverMissing = createErpMcpServer({
        erpDir: tmpDir,
        execFileSyncImpl: () => {
          cliCalled = true
          return ""
        },
      })

      const resMissing = (await serverMissing.handleMessage({
        jsonrpc: "2.0",
        id: 60,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      })) as unknown as ToolCallResponse

      expect(resMissing.result.isError).toBe(true)
      expect(resMissing.result.content[0].text).toMatch(/boombignose-erp/i)
      expect(cliCalled).toBe(false)

      // Also refuse when supabase/config.toml has a different project_id
      fs.mkdirSync(path.join(tmpDir, "supabase"), { recursive: true })
      fs.writeFileSync(
        path.join(tmpDir, "supabase", "config.toml"),
        'project_id = "other-project"\n',
        "utf8"
      )

      const resWrongId = (await serverMissing.handleMessage({
        jsonrpc: "2.0",
        id: 61,
        method: "tools/call",
        params: { name: "list_workspaces", arguments: {} },
      })) as unknown as ToolCallResponse

      expect(resWrongId.result.isError).toBe(true)
      expect(resWrongId.result.content[0].text).toMatch(/boombignose-erp/i)
      expect(cliCalled).toBe(false)
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true })
    }
  })
  describe("finance_summary matches the dashboard", () => {
    const baht = (n: number) => n * 100
    const invoice = (id: string, status: string, amountBaht: number) => ({
      id,
      org_id: ORG_A,
      status,
      amount_satang: baht(amountBaht),
      discount_satang: 0,
    })
    const payment = (id: string, invoiceId: string, amountBaht: number, state: string) => ({
      id,
      org_id: ORG_A,
      invoice_id: invoiceId,
      amount_satang: baht(amountBaht),
      paid_at: "2026-10-02T03:00:00Z",
      verification_state: state,
    })
    const cost = (id: string, incurredOn: string, amountBaht: number) => ({
      id,
      org_id: ORG_A,
      category: "software",
      amount_satang: baht(amountBaht),
      input_vat_satang: 0,
      incurred_on: incurredOn,
    })
    const store = (burnSatang: number | null = null) => ({
      organizations: [{ id: ORG_A, name: "Alpha Co", slug: "alpha" }],
      org_settings: [
        { org_id: ORG_A, cash_balance_satang: baht(100_000), monthly_burn_satang: burnSatang },
      ],
      invoices: [
        invoice("inv-legacy", "paid", 10_000),
        invoice("inv-part", "sent", 30_000),
        invoice("inv-done", "paid", 5_000),
        invoice("inv-draft", "draft", 7_000),
        invoice("inv-void", "cancelled", 9_000),
      ],
      payments: [
        payment("pay-1", "inv-legacy", 10_000, "legacy_unverified"),
        payment("pay-2", "inv-part", 12_000, "verified"),
        payment("pay-3", "inv-done", 5_000, "verified"),
      ],
      costs: [
        cost("cost-jan", "2026-01-10", 50_000),
        cost("cost-may", "2026-05-10", 50_000),
        cost("cost-sep", "2026-09-30", 20_000),
        cost("cost-oct", "2026-10-01", 50_000),
      ],
      subscriptions: [
        { id: "sub-1", org_id: ORG_A, status: "active", amount_satang: baht(1_000), interval: "monthly" },
        { id: "sub-2", org_id: ORG_A, status: "paused", amount_satang: baht(9_000), interval: "monthly" },
      ],
    })
    async function summary(data: ReturnType<typeof store>, now: string) {
      const server = createErpMcpServer({
        dataLayer: createFakeDataLayer(data),
        erpOrgId: ORG_A,
        now: new Date(now),
      })
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "finance_summary", arguments: {} },
      })) as unknown as ToolCallResponse
      expect(res.result.isError).toBeUndefined()
      return JSON.parse(res.result.content[0].text)
    }

    it("keeps gross invoiced totals separate from net collectible and verified revenue", async () => {
      const data = { ...store(), invoices: [{ ...invoice("vat", "sent", 1040), total_satang: 107000 }], payments: [payment("receipt", "vat", 1000, "verified")] }
      const out = await summary(data, "2026-10-15T05:00:00Z")
      expect(out.invoiced_total_satang).toBe(107000)
      expect(out.unpaid_satang).toBe(4000)
      expect(out.verified_paid_satang).toBe(100000)
    })

    it("burn without a setting is this month's costs, not every cost ever", async () => {
      const data = store()
      const out = await summary(data, "2026-10-15T05:00:00Z")
      expect(out.monthly_burn_satang).toBe(baht(50_000))
      expect(out.monthly_burn_satang).toBe(costsForMonth(data.costs, "2026-10"))
      expect(out.costs_total_satang).toBe(baht(170_000))
    })

    it("the burn month is the Asia/Bangkok month", async () => {
      const data = store()
      // 18:30Z on 30 Sep is 01:30 on 1 Oct in Bangkok.
      const bangkokOct = await summary(data, "2026-09-30T18:30:00Z")
      expect(bangkokOct.monthly_burn_satang).toBe(baht(50_000))
      // 16:30Z on 30 Sep is 23:30 on 30 Sep in Bangkok.
      const bangkokSep = await summary(data, "2026-09-30T16:30:00Z")
      expect(bangkokSep.monthly_burn_satang).toBe(baht(20_000))
    })

    it("inventory bills and credits are excluded from operating burn", async () => {
      const data = store()
      data.costs.push({ ...cost("stock", "2026-10-02", 90_000), category: "inventory" })
      data.costs.push({ ...cost("credit", "2026-10-03", -10_000), category: "inventory" })
      const out = await summary(data, "2026-10-15T05:00:00Z")
      expect(out.monthly_burn_satang).toBe(baht(50_000))
    })

    it("a monthly_burn setting still wins over costs", async () => {
      const out = await summary(store(baht(12_345)), "2026-10-15T05:00:00Z")
      expect(out.monthly_burn_satang).toBe(baht(12_345))
    })

    it("a paid invoice backed only by an unverified payment is unpaid", async () => {
      const data = store()
      const out = await summary(data, "2026-10-15T05:00:00Z")
      // inv-legacy 10,000 (legacy receipt only) + inv-part 30,000 - 12,000 verified.
      expect(out.unpaid_satang).toBe(baht(28_000))
      expect(out.unpaid_invoice_count).toBe(2)

      const verifiedPaid = new Map<string, number>()
      for (const p of data.payments.filter((x) => x.verification_state === "verified")) {
        verifiedPaid.set(p.invoice_id, (verifiedPaid.get(p.invoice_id) ?? 0) + p.amount_satang)
      }
      const withPaid = data.invoices.map((i) => ({
        status: i.status,
        amount_satang: i.amount_satang,
        paid_satang: verifiedPaid.get(i.id) ?? 0,
      })) as Parameters<typeof unpaidTotal>[0]
      expect(out.unpaid_satang).toBe(unpaidTotal(withPaid))
      expect(out.unpaid_invoice_count).toBe(unpaidCount(withPaid))
    })

    it("MRR counts active subscriptions like the dashboard", async () => {
      const data = store()
      const out = await summary(data, "2026-10-15T05:00:00Z")
      expect(out.mrr_satang).toBe(
        subscriptionMrr(data.subscriptions as Parameters<typeof subscriptionMrr>[0])
      )
    })
  })

  it("a large reply followed by EOF is written out completely", async () => {
    const serverScript = path.join(DEFAULT_ERP_DIR, "lib", "mcp", "erp-server.mjs")
    const child = spawn(process.execPath, [serverScript], {
      cwd: DEFAULT_ERP_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    })
    // ping echoes the id, so a long id makes a reply far above the 64 KB pipe buffer.
    const bigId = "x".repeat(300_000)
    child.stdout.pause()
    child.stdin.end(`${JSON.stringify({ jsonrpc: "2.0", id: bigId, method: "ping" })}\n`)
    await new Promise((resolve) => setTimeout(resolve, 500)) // slow reader

    const chunks: Buffer[] = []
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk))
    child.stdout.resume()
    const exitCode = await new Promise<number | null>((resolve) => {
      child.on("close", (code) => resolve(code))
    })

    expect(exitCode).toBe(0)
    expect(JSON.parse(Buffer.concat(chunks).toString("utf8"))).toEqual({
      jsonrpc: "2.0",
      id: bigId,
      result: {},
    })
  })

  it("internal errors are redacted before they reach stderr", async () => {
    const secret = ["srv", "z".repeat(20)].join("_")
    const line = '{"jsonrpc":"2.0","id":77,"method":"ping"}\n'
    const stdin = new PassThrough()
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let errText = ""
    let outText = ""
    stderr.on("data", (chunk) => (errText += String(chunk)))
    stdout.on("data", (chunk) => (outText += String(chunk)))

    // Make serialising the ping reply fail once, with the secret in the error message.
    const realStringify = JSON.stringify
    let thrown = false
    const spy = vi.spyOn(JSON, "stringify").mockImplementation(((
      value: unknown,
      ...rest: unknown[]
    ) => {
      if (!thrown && (value as { id?: unknown } | null)?.id === 77) {
        thrown = true
        throw new Error(`boom ${secret}`)
      }
      return (realStringify as (...a: unknown[]) => string)(value, ...rest)
    }) as typeof JSON.stringify)
    try {
      const { done } = startStdioServer({
        stdin,
        stdout,
        stderr,
        exitOnClose: false,
        serverOptions: { secrets: [secret], dataLayer: createFakeDataLayer({}) },
      })
      stdin.end(line)
      await done
    } finally {
      spy.mockRestore()
    }

    expect(errText).toContain("Internal MCP server error")
    expect(errText).toContain("[REDACTED]")
    expect(errText).not.toContain(secret)
    expect(outText).not.toContain(secret)
  })

  describe("finance inputs are read in full", () => {
    type Call = { table: string; col: string; val: string; range?: [number, number] }
    // Mimics PostgREST: max_rows caps each response, count is the full total.
    function pagedSupabase(rowsByTable: Record<string, Array<Record<string, unknown>>>, maxRows = 1000) {
      const calls: Call[] = []
      return {
        calls,
        client: {
          from(table: string) {
            let range: [number, number] | undefined
            const builder = {
              select: () => builder,
              order: () => builder,
              eq(col: string, val: string) {
                calls.push({ table, col, val, range })
                return builder
              },
              range(from: number, to: number) {
                range = [from, to]
                calls.push({ table, col: "range", val: `${from}-${to}`, range })
                return builder
              },
              then(resolve: (v: unknown) => void) {
                const all = rowsByTable[table] ?? []
                const [from, to] = range ?? [0, all.length - 1]
                resolve({
                  data: all.slice(from, Math.min(to + 1, from + maxRows)),
                  error: null,
                  count: all.length,
                })
              },
            }
            return builder
          },
        },
      }
    }
    const invoices = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `inv-${i}`,
        org_id: ORG_A,
        status: "sent",
        amount_satang: 100,
      }))

    it("pages past PostgREST max_rows so totals are not cut off", async () => {
      const { client, calls } = pagedSupabase({ invoices: invoices(2500) })
      const layer = createSupabaseDataLayer(client)
      const inputs = await layer.getFinanceInputs(ORG_A)
      expect(inputs.invoices).toHaveLength(2500)
      expect(new Set(inputs.invoices.map((r) => String(r.id))).size).toBe(2500)
      expect(
        calls.filter((c) => c.table === "invoices" && c.col === "range").map((c) => c.val)
      ).toEqual(["0-999", "1000-1999", "2000-2999"])
      for (const call of calls.filter((c) => c.col !== "range")) {
        expect(call).toMatchObject({ col: "org_id", val: ORG_A })
      }

      const out = (await runTool(
        "finance_summary",
        { org_id: ORG_A },
        {
          dataLayer: {
            ...layer,
            listOrganizations: async () => ({
              rows: [{ id: ORG_A, name: "Alpha Co", slug: "alpha" }],
              total: 1,
            }),
          },
        }
      )) as Record<string, unknown>
      expect(out.invoiced_total_satang).toBe(250_000)
      expect(out.unpaid_invoice_count).toBe(2500)
    })

    it("fails instead of returning a short set", async () => {
      // The server claims 1500 rows but stops serving after the first page.
      const { client } = pagedSupabase({ invoices: invoices(1500) }, 1000)
      const wrapped = {
        from(table: string) {
          const builder = client.from(table)
          const realRange = builder.range
          builder.range = (from: number, to: number) =>
            realRange(from >= 1000 ? 9_999 : from, from >= 1000 ? 9_999 : to)
          return builder
        },
      }
      const layer = createSupabaseDataLayer(wrapped)
      await expect(layer.getFinanceInputs(ORG_A)).rejects.toThrow(
        /Incomplete read of invoices/
      )
    })
  })
  describe("list_invoices matches the finance page", () => {
    const baht = (n: number) => n * 100
    const row = (
      id: string,
      status: string,
      amountBaht: number,
      dueDate: string | null,
      createdAt = "2026-09-01T00:00:00Z",
      clientId = "client-a"
    ) => ({
      id,
      org_id: ORG_A,
      client_id: clientId,
      number: `N-${id}`,
      status,
      issue_date: "2026-08-01",
      due_date: dueDate,
      amount_satang: baht(amountBaht),
      discount_satang: 0,
      created_at: createdAt,
    })
    const pay = (invoiceId: string, amountBaht: number, state: string) => ({
      id: `pay-${invoiceId}-${state}`,
      org_id: ORG_A,
      invoice_id: invoiceId,
      amount_satang: baht(amountBaht),
      paid_at: "2026-09-05T03:00:00Z",
      verification_state: state,
    })
    const data = () => ({
      organizations: [{ id: ORG_A, name: "Alpha Co", slug: "alpha" }],
      invoices: [
        row("inv-overdue", "sent", 10_000, "2026-09-01", "2026-09-01T00:00:00Z"),
        row("inv-legacy", "paid", 10_000, "2026-12-01", "2026-09-02T00:00:00Z"),
        row("inv-part", "sent", 10_000, "2026-12-01", "2026-09-03T00:00:00Z"),
        row("inv-paid", "sent", 10_000, "2026-09-01", "2026-09-04T00:00:00Z"),
        row("inv-draft", "draft", 10_000, "2026-09-01", "2026-09-05T00:00:00Z"),
        row("inv-void", "cancelled", 10_000, "2026-09-01", "2026-09-06T00:00:00Z"),
        row("inv-today", "sent", 10_000, "2026-10-15", "2026-09-07T00:00:00Z"),
        row("inv-undated", "sent", 10_000, null, "2026-09-08T00:00:00Z", "client-b"),
      ],
      payments: [
        pay("inv-legacy", 10_000, "legacy_unverified"),
        pay("inv-part", 4_000, "verified"),
        pay("inv-paid", 10_000, "verified"),
      ],
    })
    async function list(args: Record<string, unknown>, now = "2026-10-15T05:00:00Z") {
      const server = createErpMcpServer({
        dataLayer: createFakeDataLayer(data()),
        erpOrgId: ORG_A,
        now: new Date(now),
      })
      const res = (await server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name: "list_invoices", arguments: args },
      })) as unknown as ToolCallResponse
      expect(res.result.isError).toBeUndefined()
      return JSON.parse(res.result.content[0].text) as {
        items: Array<Record<string, unknown>>
        total: number
        has_more: boolean
      }
    }

    it("returns the effective status that deriveInvoiceStatus gives", async () => {
      const now = "2026-10-15T05:00:00Z"
      const { invoices, payments } = data()
      const paid = new Map<string, number>()
      for (const p of payments.filter((x) => x.verification_state === "verified")) {
        paid.set(p.invoice_id, (paid.get(p.invoice_id) ?? 0) + p.amount_satang)
      }
      const out = await list({})
      expect(out.total).toBe(invoices.length)
      for (const inv of invoices) {
        const item = out.items.find((i) => i.id === inv.id)
        const expected = deriveInvoiceStatus(
          {
            status: inv.status as Parameters<typeof deriveInvoiceStatus>[0]["status"],
            amount_satang: inv.amount_satang,
            due_date: inv.due_date,
          },
          paid.get(inv.id) ?? 0,
          todayISO(new Date(now))
        )
        expect(item?.status, inv.id).toBe(expected)
        expect(item?.stored_status, inv.id).toBe(inv.status)
      }
    })

    it("an overdue invoice appears under status=overdue", async () => {
      const out = await list({ status: "overdue" })
      expect(out.items.map((i) => i.id)).toEqual(["inv-overdue"])
      expect(out.items[0]).toMatchObject({
        status: "overdue",
        stored_status: "sent",
        paid_satang: 0,
        outstanding_satang: baht(10_000),
        outstanding_thb: "฿10,000.00",
      })
    })

    it("a paid invoice with only a legacy receipt is not paid", async () => {
      const paid = await list({ status: "paid" })
      expect(paid.items.map((i) => i.id)).toEqual(["inv-paid"])
      const legacy = (await list({})).items.find((i) => i.id === "inv-legacy")
      expect(legacy).toMatchObject({
        status: "sent",
        stored_status: "paid",
        paid_satang: 0,
        outstanding_satang: baht(10_000),
      })
    })

    it("reports verified paid and outstanding for a partial payment", async () => {
      const out = await list({ status: "partially_paid" })
      expect(out.items).toHaveLength(1)
      expect(out.items[0]).toMatchObject({
        id: "inv-part",
        paid_satang: baht(4_000),
        paid_thb: "฿4,000.00",
        outstanding_satang: baht(6_000),
        outstanding_thb: "฿6,000.00",
      })
    })

    it("due today is not overdue, and today is the Asia/Bangkok day", async () => {
      expect((await list({})).items.find((i) => i.id === "inv-today")?.status).toBe("sent")
      // 18:00Z on 14 Oct is 01:00 on 15 Oct in Bangkok, still 14 Oct in UTC.
      const lateNight = await list({}, "2026-10-14T18:00:00Z")
      expect(lateNight.items.find((i) => i.id === "inv-today")?.status).toBe("sent")
      const nextDay = await list({}, "2026-10-15T18:00:00Z")
      expect(nextDay.items.find((i) => i.id === "inv-today")?.status).toBe("overdue")
    })

    it("filters by client and pages newest first", async () => {
      expect((await list({ client_id: "client-b" })).items.map((i) => i.id)).toEqual([
        "inv-undated",
      ])
      const first = await list({ limit: 3 })
      expect(first.items.map((i) => i.id)).toEqual(["inv-undated", "inv-today", "inv-void"])
      expect(first.has_more).toBe(true)
      const last = await list({ limit: 3, offset: 6 })
      expect(last.items.map((i) => i.id)).toEqual(["inv-legacy", "inv-overdue"])
      expect(last.has_more).toBe(false)
    })
  })

  describe("stable list ordering", () => {
    // A database may return rows that tie on the sort key in any order, differently per query.
    function tieScramblingSupabase(rows: Array<Record<string, unknown>>) {
      let queries = 0
      const orders: Array<Array<[string, boolean]>> = []
      return {
        orders,
        client: {
          from() {
            const mine: Array<[string, boolean]> = []
            orders.push(mine)
            let range: [number, number] = [0, rows.length - 1]
            const builder = {
              select: () => builder,
              eq: () => builder,
              order(col: string, opts: { ascending: boolean }) {
                mine.push([col, opts.ascending])
                return builder
              },
              range(from: number, to: number) {
                range = [from, to]
                return builder
              },
              then(resolve: (v: unknown) => void) {
                queries += 1
                const compare = (a: Record<string, unknown>, b: Record<string, unknown>) => {
                  for (const [col, asc] of mine) {
                    const x = String(a[col])
                    const y = String(b[col])
                    if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1)
                  }
                  return 0
                }
                const sorted = [...rows].sort(compare)
                // Reverse every run of tied rows on alternate queries.
                const out: Array<Record<string, unknown>> = []
                for (let i = 0; i < sorted.length; ) {
                  let j = i
                  while (j < sorted.length && compare(sorted[i], sorted[j]) === 0) j += 1
                  const run = sorted.slice(i, j)
                  out.push(...(queries % 2 === 1 ? run.reverse() : run))
                  i = j
                }
                resolve({ data: out.slice(range[0], range[1] + 1), error: null, count: rows.length })
              },
            }
            return builder
          },
        },
      }
    }

    it("pages over rows with the same created_at without repeats or gaps", async () => {
      const rows = Array.from({ length: 7 }, (_, i) => ({
        id: `client-${i}`,
        org_id: ORG_A,
        name: `Client ${i}`,
        created_at: "2026-01-01T00:00:00Z",
      }))
      const { client, orders } = tieScramblingSupabase(rows)
      const layer = createSupabaseDataLayer(client)
      const ids: string[] = []
      for (const offset of [0, 3, 6]) {
        const page = await layer.listClients(ORG_A, { limit: 3, offset })
        ids.push(...page.rows.map((r: Record<string, unknown>) => String(r.id)))
      }
      expect(ids).toEqual(rows.map((r) => r.id))
      expect(orders[0]).toEqual([
        ["created_at", false],
        ["id", true],
      ])
    })

    it("orders organizations by created_at then id", async () => {
      const rows = Array.from({ length: 4 }, (_, i) => ({
        id: `org-${i}`,
        name: `Org ${i}`,
        slug: `org-${i}`,
        created_at: "2026-01-01T00:00:00Z",
      }))
      const { client } = tieScramblingSupabase(rows)
      const layer = createSupabaseDataLayer(client)
      const ids: string[] = []
      for (const offset of [0, 2]) {
        const page = await layer.listOrganizations({ limit: 2, offset })
        ids.push(...page.rows.map((r: Record<string, unknown>) => String(r.id)))
      }
      expect(ids).toEqual(["org-0", "org-1", "org-2", "org-3"])
    })
  })

  describe("organization lookup", () => {
    const org = { id: ORG_A, name: "Alpha Co", slug: "alpha" }

    it("looks an explicit org_id up directly instead of reading a list page", async () => {
      const calls: unknown[] = []
      const dataLayer = {
        async listOrganizations(opts: unknown) {
          calls.push(opts)
          return { rows: [org], total: 2 }
        },
      }
      await expect(resolveOrg({ org_id: ORG_A }, dataLayer)).resolves.toEqual(org)
      expect(calls).toEqual([{ id: ORG_A, limit: 1, offset: 0 }])
    })

    it("uses the total, not the page, to detect a single organization", async () => {
      const only = { async listOrganizations() { return { rows: [org], total: 1 } } }
      await expect(resolveOrg({}, only)).resolves.toEqual(org)
      const many = { async listOrganizations() { return { rows: [org], total: 1500 } } }
      await expect(resolveOrg({}, many)).rejects.toThrow(/org_id is required/)
    })

    it("rejects an org_id that is not a uuid without querying", async () => {
      let called = false
      const dataLayer = {
        async listOrganizations() {
          called = true
          return { rows: [], total: 0 }
        },
      }
      await expect(resolveOrg({ org_id: "not-a-uuid" }, dataLayer)).rejects.toThrow(
        "Unknown organization: not-a-uuid"
      )
      expect(called).toBe(false)
    })
  })
})
