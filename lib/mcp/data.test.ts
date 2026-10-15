import { describe, expect, it } from "vitest"
import {
  assertLocalSupabaseUrl,
  createSupabaseDataLayer,
  formatTHB,
  loadSupabaseStatusConfig,
  parseSupabaseStatusEnv,
  toSatang,
  verifyErpSupabaseConfig,
} from "./data.mjs"

const ORG_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
const CONFIG_OK = 'project_id = "boombignose-erp" # local stack\n'
const fsWith = (content: string) => ({ readFileSync: () => content }) as never

describe("money helpers", () => {
  it("formatTHB keeps exact satang, including negatives under one baht", () => {
    expect(formatTHB(123456)).toBe("฿1,234.56")
    expect(formatTHB(1)).toBe("฿0.01")
    expect(formatTHB(-50)).toBe("-฿0.50")
    expect(formatTHB(-150)).toBe("-฿1.50")
    expect(formatTHB(BigInt(100))).toBe("฿1.00")
    expect(formatTHB(Number.MAX_SAFE_INTEGER)).toBe("฿90,071,992,547,409.91")
    expect(formatTHB(null)).toBeNull()
    expect(formatTHB(undefined)).toBeNull()
  })

  it("formatTHB refuses a fraction or an unsafe integer", () => {
    expect(() => formatTHB(1.5)).toThrow("Invalid integer satang")
    expect(() => formatTHB(Number.MAX_SAFE_INTEGER + 1)).toThrow("Invalid integer satang")
  })

  it("toSatang accepts integer numbers, strings and bigints, and refuses the rest", () => {
    expect(toSatang(null)).toBe(0)
    expect(toSatang(undefined)).toBe(0)
    expect(toSatang("2500000")).toBe(2500000)
    expect(toSatang(BigInt(-42))).toBe(-42)
    for (const bad of [12.5, "12.50", "abc", Number.NaN, BigInt(Number.MAX_SAFE_INTEGER) + BigInt(1)]) {
      expect(() => toSatang(bad)).toThrow("Money value outside safe satang bounds")
    }
  })
})

describe("local Supabase guard", () => {
  it("accepts only loopback http(s) hosts", () => {
    for (const ok of ["http://127.0.0.1:54321", "http://localhost:54321", "https://LOCALHOST", "http://[::1]:54321"]) {
      expect(assertLocalSupabaseUrl(ok)).toBe(ok)
    }
    expect(() => assertLocalSupabaseUrl("http://localhost@evil.example")).toThrow(
      "Refusing non-local Supabase URL host: evil.example"
    )
    expect(() => assertLocalSupabaseUrl("http://127.0.0.1.evil.example")).toThrow(/non-local/)
    expect(() => assertLocalSupabaseUrl("ftp://localhost")).toThrow(/non-HTTP/)
    expect(() => assertLocalSupabaseUrl("not a url")).toThrow("Invalid Supabase API_URL")
    expect(() => assertLocalSupabaseUrl("")).toThrow("Missing Supabase API_URL")
  })

  it("parses supabase status env output", () => {
    const out = parseSupabaseStatusEnv(
      [
        "# comment",
        'API_URL="http://127.0.0.1:54321"',
        "export SERVICE_ROLE_KEY='srk'",
        "lower_case=ignored",
        "Stopped services: [x]",
        "EMPTY=",
      ].join("\r\n")
    )
    expect(out).toEqual({ API_URL: "http://127.0.0.1:54321", SERVICE_ROLE_KEY: "srk", EMPTY: "" })
    expect(parseSupabaseStatusEnv(undefined as never)).toEqual({})
  })

  it("needs a live project_id line, not a commented-out one", () => {
    expect(() => verifyErpSupabaseConfig("/erp", fsWith(CONFIG_OK))).not.toThrow()
    expect(() =>
      verifyErpSupabaseConfig("/erp", fsWith('# project_id = "boombignose-erp"\nproject_id = "other"\n'))
    ).toThrow(/does not have project_id/)
    expect(() => verifyErpSupabaseConfig("", fsWith(CONFIG_OK))).toThrow("ERP_DIR must be a non-empty path")
  })

  it("loads url and key, registering every secret-looking value before any check", () => {
    const registered: string[] = []
    const calls: unknown[][] = []
    const execFileSyncImpl = ((...args: unknown[]) => {
      calls.push(args)
      return Buffer.from(
        'API_URL="http://127.0.0.1:54321"\nSERVICE_ROLE_KEY="service-role-xyz"\nJWT_SECRET="jwt-secret-xyz"\nDB_URL="postgres://x"\n'
      )
    }) as never
    const out = loadSupabaseStatusConfig({
      erpDir: "/erp",
      execFileSyncImpl,
      fsImpl: fsWith(CONFIG_OK),
      registerSecret: (s) => registered.push(s),
    })
    expect(out).toEqual({ apiUrl: "http://127.0.0.1:54321", serviceRoleKey: "service-role-xyz" })
    expect(registered).toContain("jwt-secret-xyz")
    expect(registered).toContain("service-role-xyz")
    expect(registered).not.toContain("postgres://x")
    expect(calls[0][1]).toEqual(["status", "-o", "env", "--workdir", "/erp"])

    // A non-local URL is refused, but the key was already registered for redaction.
    const remote: string[] = []
    expect(() =>
      loadSupabaseStatusConfig({
        erpDir: "/erp",
        execFileSyncImpl: (() => 'API_URL="https://db.example.com"\nSERVICE_ROLE_KEY="remote-key-123"\n') as never,
        fsImpl: fsWith(CONFIG_OK),
        registerSecret: (s) => remote.push(s),
      })
    ).toThrow(/non-local/)
    expect(remote).toContain("remote-key-123")
  })

  it("explains a missing key or a failed status call", () => {
    const base = { erpDir: "/erp", fsImpl: fsWith(CONFIG_OK) }
    expect(() =>
      loadSupabaseStatusConfig({ ...base, execFileSyncImpl: (() => 'API_URL="http://127.0.0.1:54321"\n') as never })
    ).toThrow("Missing SERVICE_ROLE_KEY from local Supabase status")
    expect(() =>
      loadSupabaseStatusConfig({
        ...base,
        execFileSyncImpl: (() => {
          throw new Error("supabase not running")
        }) as never,
      })
    ).toThrow("Unable to read local Supabase status: supabase not running")
  })
})

describe("Supabase data layer", () => {
  function recordingClient(result: { data: unknown; error: unknown; count: unknown }) {
    const eqCalls: Array<[string, string]> = []
    const tables: string[] = []
    const builder = {
      select: () => builder,
      order: () => builder,
      range: () => builder,
      eq(col: string, val: string) {
        eqCalls.push([col, val])
        return builder
      },
      then: (resolve: (v: unknown) => void) => resolve(result),
    }
    return {
      eqCalls,
      tables,
      client: {
        from(table: string) {
          tables.push(table)
          return builder
        },
      },
    }
  }

  it("refuses a missing org before querying", async () => {
    const rec = recordingClient({ data: [], error: null, count: 0 })
    const layer = createSupabaseDataLayer(rec.client)
    await expect(layer.listClients("", { limit: 10, offset: 0 })).rejects.toThrow("org_id is required")
    expect(rec.tables).toEqual([])
  })

  it("skips empty filters and still scopes to the org", async () => {
    const rec = recordingClient({ data: [], error: null, count: 0 })
    const layer = createSupabaseDataLayer(rec.client)
    await layer.listDeals(ORG_A, { limit: 10, offset: 0, filters: { stage: "", client_id: "c1" } })
    expect(rec.eqCalls).toEqual([["org_id", ORG_A], ["client_id", "c1"]])
  })

  it("surfaces a database error with the table name", async () => {
    const rec = recordingClient({ data: null, error: { message: "boom" }, count: null })
    const layer = createSupabaseDataLayer(rec.client)
    await expect(layer.listQuotes(ORG_A, { limit: 1, offset: 0 })).rejects.toThrow(
      "Database query failed on quotes: boom"
    )
    await expect(layer.listOrganizations()).rejects.toThrow("Database query failed on organizations: boom")
  })

  it("strips undeclared columns and falls back to the row count without an exact count", async () => {
    const rec = recordingClient({
      data: [{ id: "c1", org_id: ORG_A, name: "A", notes: "PRIVATE", tax_id: "PRIVATE" }],
      error: null,
      count: null,
    })
    const layer = createSupabaseDataLayer(rec.client)
    const { rows, total } = await layer.listClients(ORG_A, { limit: 10, offset: 0 })
    expect(rows).toEqual([{ id: "c1", org_id: ORG_A, name: "A" }])
    expect(total).toBe(1)
  })
})
