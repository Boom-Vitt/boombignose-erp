import { formatTHB, pickColumns, TABLE_COLUMNS, toSatang } from "./data.mjs"

export const DEFAULT_LIMIT = 50
export const MAX_LIMIT = 100

const PAGINATION_PROPERTIES = {
  limit: {
    type: "integer",
    minimum: 1,
    maximum: MAX_LIMIT,
    description: `Maximum number of items to return (1..${MAX_LIMIT}, default ${DEFAULT_LIMIT}).`,
  },
  offset: {
    type: "integer",
    minimum: 0,
    description: "Zero-based item offset for pagination (default 0).",
  },
}

const ORG_ID_PROPERTY = {
  org_id: {
    type: "string",
    description:
      "Workspace (organization) UUID. Optional only when a single workspace exists or ERP_ORG_ID is set.",
  },
}

export const TOOLS = Object.freeze([
  {
    name: "list_workspaces",
    description:
      "List ERP workspaces (organizations) with their id, name, and slug.",
    inputSchema: {
      type: "object",
      properties: {
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_clients",
    description:
      "List clients in an ERP workspace (business fields only; excludes contact emails, phones, addresses, tax IDs, and notes).",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_deals",
    description:
      "List CRM deals in an ERP workspace with stage, satang value, THB string, and dates.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        stage: {
          type: "string",
          enum: [
            "lead",
            "contacted",
            "discovery",
            "proposal",
            "negotiation",
            "won",
            "lost",
          ],
          description: "Optional deal stage filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_quotes",
    description:
      "List quotations in an ERP workspace with status, satang amounts, and THB strings.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["draft", "sent", "accepted", "declined", "expired", "converted"],
          description: "Optional quote status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_projects",
    description:
      "List delivery projects in an ERP workspace with status, deadline, budget in satang, and THB string.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: [
            "not_started",
            "in_progress",
            "review",
            "delivered",
            "support",
            "paused",
            "cancelled",
          ],
          description: "Optional project status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    description:
      "List invoices in an ERP workspace with number, status, dates, satang amounts, and THB strings.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["draft", "sent", "partially_paid", "paid", "overdue", "cancelled"],
          description: "Optional invoice status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_payment_claims",
    description:
      "List customer and staff payment claims in an ERP workspace (status and amount only; excludes bank references and payment evidence).",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
        status: {
          type: "string",
          enum: ["pending", "verified", "rejected"],
          description: "Optional payment claim status filter.",
        },
        client_id: {
          type: "string",
          description: "Optional client UUID filter.",
        },
        invoice_id: {
          type: "string",
          description: "Optional invoice UUID filter.",
        },
        ...PAGINATION_PROPERTIES,
      },
      additionalProperties: false,
    },
  },
  {
    name: "finance_summary",
    description:
      "Return a read-only financial summary for an ERP workspace with all money totals in satang and formatted THB.",
    inputSchema: {
      type: "object",
      properties: {
        ...ORG_ID_PROPERTY,
      },
      additionalProperties: false,
    },
  },
])

/**
 * Parse and clamp pagination parameters.
 * @param {Record<string, unknown>} args
 * @returns {{ limit: number, offset: number }}
 */
export function parsePagination(args = {}) {
  let limit = DEFAULT_LIMIT
  if (args.limit !== undefined && args.limit !== null) {
    const n = Number(args.limit)
    if (!Number.isInteger(n) || n < 1) {
      throw new Error("limit must be a positive integer")
    }
    limit = Math.min(n, MAX_LIMIT)
  }
  let offset = 0
  if (args.offset !== undefined && args.offset !== null) {
    const n = Number(args.offset)
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("offset must be a non-negative integer")
    }
    offset = n
  }
  return { limit, offset }
}

/**
 * Resolve and validate the target organization ID.
 * Required unless `ERP_ORG_ID` is set or the database has exactly one organization.
 * Rejects any unknown organization ID.
 * @param {Record<string, unknown>} args
 * @param {any} dataLayer
 * @param {{ erpOrgId?: string }} [options]
 * @returns {Promise<{ id: string, name: string, slug: string }>}
 */
export async function resolveOrg(args, dataLayer, options = {}) {
  const requestedOrgId =
    typeof args?.org_id === "string" && args.org_id.trim() !== ""
      ? args.org_id.trim()
      : typeof options.erpOrgId === "string" && options.erpOrgId.trim() !== ""
        ? options.erpOrgId.trim()
        : null

  const { rows: orgs } = await dataLayer.listOrganizations()
  if (requestedOrgId) {
    const found = orgs.find((o) => o.id === requestedOrgId)
    if (!found) {
      throw new Error(`Unknown organization: ${requestedOrgId}`)
    }
    return {
      id: String(found.id),
      name: String(found.name ?? ""),
      slug: String(found.slug ?? ""),
    }
  }

  if (orgs.length === 1) {
    const sole = orgs[0]
    return {
      id: String(sole.id),
      name: String(sole.name ?? ""),
      slug: String(sole.slug ?? ""),
    }
  }

  if (orgs.length === 0) {
    throw new Error("No organizations found in ERP")
  }

  throw new Error(
    "org_id is required when multiple organizations exist and ERP_ORG_ID is not set"
  )
}

const MONTHLY_TWELFTHS = {
  weekly: 52,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
}

const BANGKOK_MONTH = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Bangkok",
  year: "numeric",
  month: "2-digit",
})

/**
 * 'YYYY-MM' of an instant in Asia/Bangkok, like monthKey() in lib/dates.ts.
 * @param {Date} date
 */
function bangkokMonthKey(date) {
  const parts = Object.fromEntries(
    BANGKOK_MONTH.formatToParts(date).map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}`
}

/**
 * Compute normalized monthly satang from active subscriptions.
 * @param {Array<Record<string, unknown>>} subscriptions
 * @returns {number}
 */
function computeSubscriptionMrrSatang(subscriptions) {
  let twelfths = BigInt(0)
  for (const sub of subscriptions) {
    if (sub.status !== "active") continue
    const amount = toSatang(sub.amount_satang)
    const factor =
      MONTHLY_TWELFTHS[/** @type {keyof typeof MONTHLY_TWELFTHS} */ (sub.interval)] ?? 0
    if (amount > 0 && factor > 0) {
      twelfths += BigInt(amount) * BigInt(factor)
    }
  }
  return Number((twelfths + BigInt(6)) / BigInt(12))
}

/**
 * Wrap a satang amount with its formatted THB string.
 * @param {unknown} rawSatang
 * @returns {{ satang: number, thb: string }}
 */
function moneyPair(rawSatang) {
  const satang = toSatang(rawSatang)
  return { satang, thb: formatTHB(satang) ?? "฿0.00" }
}

/**
 * Format a paginated response envelope.
 * @param {string | null} orgId
 * @param {Array<Record<string, unknown>>} items
 * @param {number} total
 * @param {{ limit: number, offset: number }} page
 */
function paginatedEnvelope(orgId, items, total, { limit, offset }) {
  return {
    ...(orgId ? { org_id: orgId } : {}),
    items,
    total,
    limit,
    offset,
    has_more: offset + items.length < total,
  }
}

/**
 * Execute one of the 8 ERP MCP tools against the provided data layer.
 * @param {string} name
 * @param {Record<string, unknown>} rawArgs
 * @param {{ dataLayer: any, erpOrgId?: string, now?: Date }} ctx
 */
export async function runTool(name, rawArgs, ctx) {
  const args = rawArgs && typeof rawArgs === "object" ? rawArgs : {}
  const { dataLayer, erpOrgId, now } = ctx

  if (name === "list_workspaces") {
    const page = parsePagination(args)
    const { rows, total } = await dataLayer.listOrganizations(page)
    const items = rows.map((row) => pickColumns(row, TABLE_COLUMNS.organizations))
    return paginatedEnvelope(null, items, total, page)
  }

  const org = await resolveOrg(args, dataLayer, { erpOrgId })
  const orgId = org.id

  switch (name) {
    case "list_clients": {
      const page = parsePagination(args)
      const { rows, total } = await dataLayer.listClients(orgId, page)
      const items = rows.map((row) => pickColumns(row, TABLE_COLUMNS.clients))
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_deals": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.stage === "string" && args.stage) filters.stage = args.stage
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listDeals(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.deals)
        const value = moneyPair(clean.value_satang)
        return {
          ...clean,
          value_satang: value.satang,
          value_thb: value.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_quotes": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listQuotes(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.quotes)
        const subtotal = moneyPair(clean.subtotal_satang)
        const discount = moneyPair(clean.discount_satang)
        const totalMoney = moneyPair(clean.total_satang)
        return {
          ...clean,
          subtotal_satang: subtotal.satang,
          subtotal_thb: subtotal.thb,
          discount_satang: discount.satang,
          discount_thb: discount.thb,
          total_satang: totalMoney.satang,
          total_thb: totalMoney.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_projects": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listProjects(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.projects)
        const hasBudget =
          clean.budget_satang !== null && clean.budget_satang !== undefined
        const budgetSatang = hasBudget ? toSatang(clean.budget_satang) : null
        return {
          ...clean,
          budget_satang: budgetSatang,
          budget_thb: budgetSatang !== null ? formatTHB(budgetSatang) : null,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_invoices": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id

      const { rows, total } = await dataLayer.listInvoices(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.invoices)
        const amount = moneyPair(clean.amount_satang)
        const discount = moneyPair(clean.discount_satang)
        return {
          ...clean,
          amount_satang: amount.satang,
          amount_thb: amount.thb,
          discount_satang: discount.satang,
          discount_thb: discount.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "list_payment_claims": {
      const page = parsePagination(args)
      /** @type {Record<string, string>} */
      const filters = {}
      if (typeof args.status === "string" && args.status) filters.status = args.status
      if (typeof args.client_id === "string" && args.client_id)
        filters.client_id = args.client_id
      if (typeof args.invoice_id === "string" && args.invoice_id)
        filters.invoice_id = args.invoice_id

      const { rows, total } = await dataLayer.listPaymentClaims(orgId, {
        ...page,
        filters,
      })
      const items = rows.map((row) => {
        const clean = pickColumns(row, TABLE_COLUMNS.payment_claims)
        const amount = moneyPair(clean.amount_satang)
        return {
          ...clean,
          amount_satang: amount.satang,
          amount_thb: amount.thb,
        }
      })
      return paginatedEnvelope(orgId, items, total, page)
    }

    case "finance_summary": {
      const inputs = await dataLayer.getFinanceInputs(orgId)
      const invoices = (inputs.invoices ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.invoices)
      )
      const payments = (inputs.payments ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.payments)
      )
      const costs = (inputs.costs ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.costs)
      )
      const subscriptions = (inputs.subscriptions ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.subscriptions)
      )
      const quotes = (inputs.quotes ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.quotes)
      )
      const deals = (inputs.deals ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.deals)
      )
      const claims = (inputs.paymentClaims ?? []).map((r) =>
        pickColumns(r, TABLE_COLUMNS.payment_claims)
      )
      const settings = inputs.settings
        ? pickColumns(inputs.settings, TABLE_COLUMNS.org_settings)
        : null

      const verifiedPayments = payments.filter(
        (p) => !p.verification_state || p.verification_state === "verified"
      )
      /** @type {Map<string, number>} */
      const paidByInvoice = new Map()
      let verifiedPaidSatang = 0
      for (const p of verifiedPayments) {
        const amt = toSatang(p.amount_satang)
        verifiedPaidSatang += amt
        const invId = String(p.invoice_id ?? "")
        if (invId) {
          paidByInvoice.set(invId, (paidByInvoice.get(invId) ?? 0) + amt)
        }
      }

      let invoicedTotalSatang = 0
      let unpaidSatang = 0
      let unpaidInvoiceCount = 0
      for (const inv of invoices) {
        if (inv.status === "draft" || inv.status === "cancelled") continue
        const amt = toSatang(inv.amount_satang)
        invoicedTotalSatang += amt
        const paid = paidByInvoice.get(String(inv.id ?? "")) ?? 0
        const outstanding = Math.max(0, amt - paid)
        // Same rule as unpaidTotal/unpaidCount in lib/metrics/finance.ts: a stored 'paid' status
        // without verified payments (legacy_unverified) still counts as unpaid.
        if (outstanding > 0) {
          unpaidSatang += outstanding
          unpaidInvoiceCount += 1
        }
      }

      const costsTotalSatang = costs.reduce(
        (acc, c) => acc + toSatang(c.amount_satang),
        0
      )
      // Dashboard burn fallback: only costs incurred this Asia/Bangkok month (costsForMonth).
      const thisMonth = bangkokMonthKey(now ?? new Date())
      const costsThisMonthSatang = costs
        .filter((c) => bangkokMonthKey(new Date(String(c.incurred_on))) === thisMonth)
        .reduce((acc, c) => acc + toSatang(c.amount_satang), 0)
      const cashBalanceSatang = toSatang(settings?.cash_balance_satang ?? 0)
      const monthlyBurnSatang =
        settings?.monthly_burn_satang !== null &&
        settings?.monthly_burn_satang !== undefined
          ? toSatang(settings.monthly_burn_satang)
          : costsThisMonthSatang

      const mrrSatang = computeSubscriptionMrrSatang(subscriptions)
      const openQuotes = quotes.filter(
        (q) => q.status === "draft" || q.status === "sent" || q.status === "accepted"
      )
      const openQuotesSatang = openQuotes.reduce(
        (acc, q) => acc + toSatang(q.total_satang),
        0
      )
      const openDeals = deals.filter(
        (d) => d.stage !== "won" && d.stage !== "lost"
      )
      const pipelineSatang = openDeals.reduce(
        (acc, d) => acc + toSatang(d.value_satang),
        0
      )
      const pendingClaims = claims.filter((c) => c.status === "pending")
      const pendingClaimsSatang = pendingClaims.reduce(
        (acc, c) => acc + toSatang(c.amount_satang),
        0
      )

      const cash = moneyPair(cashBalanceSatang)
      const burn = moneyPair(monthlyBurnSatang)
      const invoiced = moneyPair(invoicedTotalSatang)
      const verifiedPaid = moneyPair(verifiedPaidSatang)
      const unpaid = moneyPair(unpaidSatang)
      const costsTotal = moneyPair(costsTotalSatang)
      const mrr = moneyPair(mrrSatang)
      const openQuotesMoney = moneyPair(openQuotesSatang)
      const pipelineMoney = moneyPair(pipelineSatang)
      const pendingClaimsMoney = moneyPair(pendingClaimsSatang)

      return {
        org_id: orgId,
        cash_balance_satang: cash.satang,
        cash_balance_thb: cash.thb,
        monthly_burn_satang: burn.satang,
        monthly_burn_thb: burn.thb,
        invoiced_total_satang: invoiced.satang,
        invoiced_total_thb: invoiced.thb,
        verified_paid_satang: verifiedPaid.satang,
        verified_paid_thb: verifiedPaid.thb,
        unpaid_satang: unpaid.satang,
        unpaid_thb: unpaid.thb,
        unpaid_invoice_count: unpaidInvoiceCount,
        costs_total_satang: costsTotal.satang,
        costs_total_thb: costsTotal.thb,
        mrr_satang: mrr.satang,
        mrr_thb: mrr.thb,
        open_quotes_count: openQuotes.length,
        open_quotes_satang: openQuotesMoney.satang,
        open_quotes_thb: openQuotesMoney.thb,
        pipeline_satang: pipelineMoney.satang,
        pipeline_thb: pipelineMoney.thb,
        pending_claims_count: pendingClaims.length,
        pending_claims_satang: pendingClaimsMoney.satang,
        pending_claims_thb: pendingClaimsMoney.thb,
      }
    }

    default:
      throw new Error(`Unknown tool: ${name}`)
  }
}
