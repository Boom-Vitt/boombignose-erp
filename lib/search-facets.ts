import { z } from "zod"
import { PERIODS, inPeriod, type Period } from "@/lib/periods"
import { sumSatang } from "@/lib/money"
import { Constants } from "@/lib/types/database"

export const FACET_LISTS = {
  quotes: { statuses: Constants.public.Enums.quote_status, groups: ["status", "client", "month"] },
  finance: { statuses: Constants.public.Enums.invoice_status, groups: ["status", "client", "month"] },
  clients: { statuses: [], groups: ["industry", "source", "month"] },
  timesheets: { statuses: ["billable", "non_billable"], groups: ["project", "month"] },
  deals: { statuses: Constants.public.Enums.deal_stage, groups: ["stage", "client", "owner", "month"] },
  projects: { statuses: Constants.public.Enums.project_status, groups: ["status", "client", "owner", "month"] },
  purchases: { statuses: Constants.public.Enums.purchase_status, groups: ["status", "vendor", "month"] },
  inventory: { statuses: ["receipt", "delivery", "adjustment_in", "adjustment_out", "transfer_in", "transfer_out", "vendor_return", "customer_return"], groups: [] },
  vendors: { statuses: ["active", "archived"], groups: ["status", "month"] },
} as const
export type FacetList = keyof typeof FACET_LISTS
export type FacetConfig = { q?: string; status?: string; period?: Period; mine?: "1"; groupBy?: string; warehouse?: string; product?: string; sourceId?: string }
export type SearchParams = Record<string, string | string[] | undefined>
const KEYS = ["q", "status", "period", "mine", "groupBy", "warehouse", "product", "sourceId"] as const

export function parseFacets(params: SearchParams | URLSearchParams, list: FacetList): FacetConfig {
  const get = (key: string) => {
    const value = params instanceof URLSearchParams ? (params.getAll(key).length === 1 ? params.get(key) : undefined) : params[key]
    return typeof value === "string" ? value.trim() : ""
  }
  const config: FacetConfig = {}
  if (get("q")) config.q = get("q").slice(0, 200)
  // Deal links and saved views from before facets name the stage `stage`.
  const status = get("status") || (list === "deals" ? get("stage") : "")
  if ((FACET_LISTS[list].statuses as readonly string[]).includes(status)) config.status = status
  if (Object.hasOwn(PERIODS, get("period"))) config.period = get("period") as Period
  if (get("mine") === "1") config.mine = "1"
  if ((FACET_LISTS[list].groups as readonly string[]).includes(get("groupBy"))) config.groupBy = get("groupBy")
  if (list === "inventory") for (const key of ["warehouse", "product", "sourceId"] as const) {
    const parsed = z.guid().safeParse(get(key))
    if (parsed.success) config[key] = parsed.data
  }
  return config
}

export function serializeFacets(config: FacetConfig, list: FacetList): string {
  const clean = parseFacets(config, list)
  const params = new URLSearchParams()
  for (const key of KEYS) if (clean[key]) params.set(key, clean[key]!)
  return params.toString()
}

export function facetLabel(value: string): string {
  return value.split("_").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ")
}

export function matchesFacets(config: FacetConfig, row: { text: string; status?: string; date: string | null; owner: string | null }, userId: string, now: Date = new Date()): boolean {
  return (!config.q || row.text.toLowerCase().includes(config.q.toLowerCase()))
    && (!config.status || row.status === config.status)
    && (!config.period || (row.date !== null && inPeriod(row.date, config.period, now)))
    && (!config.mine || row.owner === userId)
}

export function groupFacetRows<T>(rows: T[], group?: (row: T) => { key: string; label: string }, amount?: (row: T) => number) {
  const groups = new Map<string, { key: string; label: string; rows: T[] }>()
  for (const row of rows) {
    const value = group?.(row) ?? { key: "all", label: "" }
    if (!groups.has(value.key)) groups.set(value.key, { ...value, rows: [] })
    groups.get(value.key)!.rows.push(row)
  }
  return [...groups.values()].map((value) => ({
    ...value,
    totalSatang: amount ? sumSatang(value.rows.map(amount)) : undefined,
  }))
}
