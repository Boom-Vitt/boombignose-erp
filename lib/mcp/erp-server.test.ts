import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createInterface } from "node:readline"
import { describe, expect, it } from "vitest"
import {
  assertLocalSupabaseUrl,
  createFakeDataLayer,
  createSupabaseDataLayer,
  formatTHB,
} from "./data.mjs"
import { createErpMcpServer, DEFAULT_ERP_DIR } from "./erp-server.mjs"
import { TOOLS } from "./tools.mjs"

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

    expect(eqCalls.length).toBe(14)
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
})
