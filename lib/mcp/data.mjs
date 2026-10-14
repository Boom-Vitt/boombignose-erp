import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"

const thbFormatter = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Format integer satang as a Thai Baht currency string (e.g. 123456 -> "฿1,234.56").
 * @param {number | bigint | null | undefined} satang
 * @returns {string | null}
 */
export function formatTHB(satang) {
  if (satang === null || satang === undefined) return null
  const num = typeof satang === "bigint" ? Number(satang) : Number(satang)
  if (!Number.isSafeInteger(num)) {
    throw new Error("Invalid integer satang")
  }
  const absolute = BigInt(Math.abs(num))
  const whole = absolute / BigInt(100)
  const fraction = String(absolute % BigInt(100)).padStart(2, "0")
  const signedWhole = num < 0 ? -whole : whole
  const value = num < 0 && whole === BigInt(0) ? -0 : signedWhole
  return thbFormatter
    .formatToParts(value)
    .map((part) => (part.type === "fraction" ? fraction : part.value))
    .join("")
}

/**
 * Normalize a satang value to a safe integer.
 * @param {unknown} value
 * @returns {number}
 */
export function toSatang(value) {
  if (value === null || value === undefined) return 0
  const n = typeof value === "bigint" ? Number(value) : Number(value)
  if (!Number.isSafeInteger(n)) {
    throw new Error("Money value outside safe satang bounds")
  }
  return n
}

const PROJECT_ID_RE = /^\s*project_id\s*=\s*"boombignose-erp"\s*(?:#.*)?$/m

/**
 * Verify that `<erpDir>/supabase/config.toml` exists and declares `project_id = "boombignose-erp"`.
 * @param {string} erpDir
 * @param {Pick<typeof fs, "readFileSync">} [fsImpl]
 */
export function verifyErpSupabaseConfig(erpDir, fsImpl = fs) {
  if (!erpDir || typeof erpDir !== "string") {
    throw new Error("ERP_DIR must be a non-empty path")
  }
  const configPath = path.join(erpDir, "supabase", "config.toml")
  let content = ""
  try {
    content = fsImpl.readFileSync(configPath, "utf8")
  } catch {
    throw new Error(
      `Refusing ERP_DIR without supabase/config.toml (expected project_id "boombignose-erp")`
    )
  }
  if (!PROJECT_ID_RE.test(content)) {
    throw new Error(
      `Refusing ERP_DIR whose supabase/config.toml does not have project_id "boombignose-erp"`
    )
  }
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"])

/**
 * Ensure the Supabase API URL points to a loopback/local host.
 * @param {string} rawUrl
 * @returns {string}
 */
export function assertLocalSupabaseUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new Error("Missing Supabase API_URL")
  }
  let parsed
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error("Invalid Supabase API_URL")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Refusing non-HTTP Supabase URL protocol: ${parsed.protocol}`)
  }
  if (!LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new Error(`Refusing non-local Supabase URL host: ${parsed.hostname}`)
  }
  return rawUrl
}

/**
 * Parse `supabase status -o env` stdout lines into a key-value map.
 * @param {string} stdout
 * @returns {Record<string, string>}
 */
export function parseSupabaseStatusEnv(stdout) {
  /** @type {Record<string, string>} */
  const parsed = {}
  for (const rawLine of String(stdout ?? "").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue
    const match = line.match(/^(?:export\s+)?([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (!match) continue
    const key = match[1]
    let value = match[2].trim()
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1)
    }
    parsed[key] = value
  }
  return parsed
}

/**
 * Load local Supabase `API_URL` and `SERVICE_ROLE_KEY` via `<ERP_DIR>/node_modules/.bin/supabase`.
 * Checks `<ERP_DIR>/supabase/config.toml` first and parses stdout only.
 * @param {{
 *   erpDir: string,
 *   execFileSyncImpl?: typeof execFileSync,
 *   fsImpl?: Pick<typeof fs, "readFileSync">,
 *   registerSecret?: (secret: string) => void
 * }} options
 * @returns {{ apiUrl: string, serviceRoleKey: string }}
 */
export function loadSupabaseStatusConfig({
  erpDir,
  execFileSyncImpl = execFileSync,
  fsImpl = fs,
  registerSecret,
}) {
  verifyErpSupabaseConfig(erpDir, fsImpl)
  const supabaseBin = path.join(erpDir, "node_modules", ".bin", "supabase")
  let stdout = ""
  try {
    const output = execFileSyncImpl(
      supabaseBin,
      ["status", "-o", "env", "--workdir", erpDir],
      {
        cwd: erpDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    )
    stdout = typeof output === "string" ? output : Buffer.from(output).toString("utf8")
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`Unable to read local Supabase status: ${msg}`)
  }

  const vars = parseSupabaseStatusEnv(stdout)
  for (const [k, v] of Object.entries(vars)) {
    if (v && (k.includes("KEY") || k.includes("SECRET") || k.includes("TOKEN") || k.includes("PASSWORD"))) {
      registerSecret?.(v)
    }
  }

  const serviceRoleKey = vars.SERVICE_ROLE_KEY ?? ""
  if (serviceRoleKey) {
    registerSecret?.(serviceRoleKey)
  }
  const apiUrl = assertLocalSupabaseUrl(vars.API_URL ?? "")
  if (!serviceRoleKey) {
    throw new Error("Missing SERVICE_ROLE_KEY from local Supabase status")
  }

  return { apiUrl, serviceRoleKey }
}

export const TABLE_COLUMNS = Object.freeze({
  organizations: "id,name,slug,created_at,updated_at",
  clients: "id,org_id,name,industry,source,created_at,updated_at",
  deals:
    "id,org_id,client_id,title,stage,value_satang,currency,expected_close_date,next_follow_up_date,source,created_at,updated_at",
  quotes:
    "id,org_id,client_id,project_id,number,status,issue_date,valid_until,subtotal_satang,discount_satang,total_satang,converted_invoice_id,created_at,updated_at",
  projects:
    "id,org_id,deal_id,client_id,source_quote_id,name,status,deadline,budget_satang,created_at,updated_at",
  invoices:
    "id,org_id,client_id,project_id,source_quote_id,source_milestone_id,number,status,issue_date,due_date,amount_satang,discount_satang,is_recurring,recurring_interval,created_at,updated_at",
  payment_claims:
    "id,org_id,client_id,invoice_id,amount_satang,status,source,reviewed_at,payment_id,created_at,updated_at",
  org_settings: "org_id,cash_balance_satang,monthly_burn_satang",
  payments: "id,org_id,invoice_id,amount_satang,paid_at,method,verification_state",
  costs: "id,org_id,project_id,category,amount_satang,incurred_on",
  subscriptions: "id,org_id,status,amount_satang,interval",
})

/**
 * Pick only the comma-separated columns from a row object.
 * Guarantees no disallowed columns (notes, emails, phones, references, tokens) ever leak.
 * @param {Record<string, unknown>} row
 * @param {string} columnSpec
 * @returns {Record<string, unknown>}
 */
export function pickColumns(row, columnSpec) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const col of columnSpec.split(",")) {
    const key = col.trim()
    if (key && Object.hasOwn(row, key)) {
      out[key] = row[key]
    }
  }
  return out
}

/** PostgREST's default max_rows is 1000 (supabase/config.toml); page no larger. */
const FINANCE_PAGE_SIZE = 1000

/**
 * Create a read-only Supabase data layer. Uses `.select(explicitColumns)` and `.eq("org_id", orgId)` on every tenant query.
 * @param {any} supabase
 */
export function createSupabaseDataLayer(supabase) {
  /**
   * @param {keyof typeof TABLE_COLUMNS} table
   * @param {string} orgId
   * @param {{ filters?: Record<string, string>, limit?: number, offset?: number, orderBy?: string }} [opts]
   */
  async function selectOrgScoped(table, orgId, opts = {}) {
    if (!orgId || typeof orgId !== "string") {
      throw new Error("org_id is required")
    }
    const columns = TABLE_COLUMNS[table]
    let query = supabase
      .from(table)
      .select(columns, { count: "exact" })
      .eq("org_id", orgId)

    if (opts.filters) {
      for (const [col, val] of Object.entries(opts.filters)) {
        if (val !== undefined && val !== null && val !== "") {
          query = query.eq(col, val)
        }
      }
    }
    if (opts.orderBy) {
      query = query.order(opts.orderBy, { ascending: false })
    }
    if (typeof opts.limit === "number" && typeof opts.offset === "number") {
      query = query.range(opts.offset, opts.offset + opts.limit - 1)
    }

    const { data, error, count } = await query
    if (error) {
      throw new Error(`Database query failed on ${table}: ${error.message}`)
    }
    const rows = (data ?? []).map((row) => pickColumns(row, columns))
    return { rows, total: typeof count === "number" ? count : rows.length }
  }

  /**
   * Read every row of an org's table, page by page (PostgREST caps one response at max_rows).
   * Throws rather than return a truncated set, so finance totals are never silently short.
   * @param {keyof typeof TABLE_COLUMNS} table
   * @param {string} orgId
   * @param {string} orderBy unique column, so pages do not overlap
   */
  async function selectAllOrgScoped(table, orgId, orderBy) {
    /** @type {Array<Record<string, unknown>>} */
    const rows = []
    let total = 0
    do {
      const page = await selectOrgScoped(table, orgId, {
        orderBy,
        limit: FINANCE_PAGE_SIZE,
        offset: rows.length,
      })
      total = page.total
      rows.push(...page.rows)
      if (page.rows.length === 0) break
    } while (rows.length < total)
    if (rows.length < total) {
      throw new Error(`Incomplete read of ${table}: ${rows.length} of ${total} rows`)
    }
    return rows
  }

  return {
    async listOrganizations({ limit, offset } = {}) {
      const columns = TABLE_COLUMNS.organizations
      let query = supabase
        .from("organizations")
        .select(columns, { count: "exact" })
        .order("created_at", { ascending: true })
      if (typeof limit === "number" && typeof offset === "number") {
        query = query.range(offset, offset + limit - 1)
      }
      const { data, error, count } = await query
      if (error) {
        throw new Error(`Database query failed on organizations: ${error.message}`)
      }
      const rows = (data ?? []).map((row) => pickColumns(row, columns))
      return { rows, total: typeof count === "number" ? count : rows.length }
    },

    async listClients(orgId, opts) {
      return selectOrgScoped("clients", orgId, { orderBy: "created_at", ...opts })
    },

    async listDeals(orgId, opts) {
      return selectOrgScoped("deals", orgId, { orderBy: "created_at", ...opts })
    },

    async listQuotes(orgId, opts) {
      return selectOrgScoped("quotes", orgId, { orderBy: "created_at", ...opts })
    },

    async listProjects(orgId, opts) {
      return selectOrgScoped("projects", orgId, { orderBy: "created_at", ...opts })
    },

    async listInvoices(orgId, opts) {
      return selectOrgScoped("invoices", orgId, { orderBy: "created_at", ...opts })
    },

    async listPaymentClaims(orgId, opts) {
      return selectOrgScoped("payment_claims", orgId, { orderBy: "created_at", ...opts })
    },

    async getFinanceInputs(orgId) {
      const [
        settings,
        invoices,
        payments,
        costs,
        subscriptions,
        quotes,
        deals,
        paymentClaims,
      ] = await Promise.all([
        selectAllOrgScoped("org_settings", orgId, "org_id"),
        selectAllOrgScoped("invoices", orgId, "id"),
        selectAllOrgScoped("payments", orgId, "id"),
        selectAllOrgScoped("costs", orgId, "id"),
        selectAllOrgScoped("subscriptions", orgId, "id"),
        selectAllOrgScoped("quotes", orgId, "id"),
        selectAllOrgScoped("deals", orgId, "id"),
        selectAllOrgScoped("payment_claims", orgId, "id"),
      ])
      return {
        settings: settings[0] ?? null,
        invoices,
        payments,
        costs,
        subscriptions,
        quotes,
        deals,
        paymentClaims,
      }
    },
  }
}

/**
 * Create an in-memory fake data layer for testing protocol, org scoping, and privacy rules.
 * @param {{
 *   organizations?: Array<Record<string, unknown>>,
 *   clients?: Array<Record<string, unknown>>,
 *   deals?: Array<Record<string, unknown>>,
 *   quotes?: Array<Record<string, unknown>>,
 *   projects?: Array<Record<string, unknown>>,
 *   invoices?: Array<Record<string, unknown>>,
 *   payment_claims?: Array<Record<string, unknown>>,
 *   org_settings?: Array<Record<string, unknown>>,
 *   payments?: Array<Record<string, unknown>>,
 *   costs?: Array<Record<string, unknown>>,
 *   subscriptions?: Array<Record<string, unknown>>,
 * }} [store]
 */
export function createFakeDataLayer(store = {}) {
  /** @type {Array<{ table: string, orgId: string | null, filters?: Record<string, string>, operation: "select" }>} */
  const queries = []

  /**
   * @param {keyof typeof TABLE_COLUMNS} table
   * @param {string} orgId
   * @param {{ filters?: Record<string, string>, limit?: number, offset?: number }} [opts]
   */
  function queryScoped(table, orgId, opts = {}) {
    if (!orgId || typeof orgId !== "string") {
      throw new Error("org_id is required")
    }
    queries.push({ table, orgId, filters: opts.filters, operation: "select" })
    const source = Array.isArray(store[table]) ? store[table] : []
    const columns = TABLE_COLUMNS[table]
    const matched = source
      .filter((row) => row.org_id === orgId)
      .filter((row) => {
        if (!opts.filters) return true
        return Object.entries(opts.filters).every(
          ([k, v]) => v === undefined || v === "" || row[k] === v
        )
      })
      .map((row) => pickColumns(row, columns))
    const total = matched.length
    const offset = opts.offset ?? 0
    const limit = opts.limit ?? total
    const rows = matched.slice(offset, offset + limit)
    return { rows, total }
  }

  return {
    queries,

    async listOrganizations({ limit, offset } = {}) {
      queries.push({ table: "organizations", orgId: null, operation: "select" })
      const source = Array.isArray(store.organizations) ? store.organizations : []
      const columns = TABLE_COLUMNS.organizations
      const matched = source.map((row) => pickColumns(row, columns))
      const total = matched.length
      const start = offset ?? 0
      const count = limit ?? total
      return { rows: matched.slice(start, start + count), total }
    },

    async listClients(orgId, opts) {
      return queryScoped("clients", orgId, opts)
    },

    async listDeals(orgId, opts) {
      return queryScoped("deals", orgId, opts)
    },

    async listQuotes(orgId, opts) {
      return queryScoped("quotes", orgId, opts)
    },

    async listProjects(orgId, opts) {
      return queryScoped("projects", orgId, opts)
    },

    async listInvoices(orgId, opts) {
      return queryScoped("invoices", orgId, opts)
    },

    async listPaymentClaims(orgId, opts) {
      return queryScoped("payment_claims", orgId, opts)
    },

    async getFinanceInputs(orgId) {
      const settingsRes = queryScoped("org_settings", orgId)
      const invoicesRes = queryScoped("invoices", orgId)
      const paymentsRes = queryScoped("payments", orgId)
      const costsRes = queryScoped("costs", orgId)
      const subscriptionsRes = queryScoped("subscriptions", orgId)
      const quotesRes = queryScoped("quotes", orgId)
      const dealsRes = queryScoped("deals", orgId)
      const claimsRes = queryScoped("payment_claims", orgId)
      return {
        settings: settingsRes.rows[0] ?? null,
        invoices: invoicesRes.rows,
        payments: paymentsRes.rows,
        costs: costsRes.rows,
        subscriptions: subscriptionsRes.rows,
        quotes: quotesRes.rows,
        deals: dealsRes.rows,
        paymentClaims: claimsRes.rows,
      }
    },
  }
}
