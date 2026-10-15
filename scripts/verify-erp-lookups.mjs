#!/usr/bin/env node
/**
 * Checks the ERP MCP lookup tools (get_customer, get_product, get_order, get_invoice) against the
 * local Supabase stack: for sample rows of every workspace, the tool answer by id and by number/name
 * must match what a direct query of the same rows says. Read-only. Prints ids and counts only (no
 * customer names), since this may run against real data.
 *
 * Usage (from project root, local stack running): node scripts/verify-erp-lookups.mjs
 */
import { randomUUID } from "node:crypto"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { createClient } from "@supabase/supabase-js"
import { createSupabaseDataLayer, loadSupabaseStatusConfig } from "../lib/mcp/data.mjs"
import { runTool } from "../lib/mcp/tools.mjs"

const SAMPLES = 3
const erpDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const { apiUrl, serviceRoleKey } = loadSupabaseStatusConfig({ erpDir })
const sb = createClient(apiUrl, serviceRoleKey, { auth: { persistSession: false } })
const dataLayer = createSupabaseDataLayer(sb)

let failures = 0
let checks = 0
const check = (name, ok, extra = "") => {
  checks += 1
  if (!ok) failures += 1
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`)
}

/** Direct read, independent of the MCP data layer. */
async function raw(table, columns, orgId, filters = {}, limit = 1000) {
  let q = sb.from(table).select(columns).eq("org_id", orgId)
  for (const [k, v] of Object.entries(filters)) q = q.eq(k, v)
  const { data, error } = await q.order("id").limit(limit)
  if (error) throw new Error(`${table}: ${error.message}`)
  return data
}

const sum = (rows, col) => rows.reduce((acc, r) => acc + Number(r[col]), 0)
const tool = (name, orgId, args) => runTool(name, { org_id: orgId, ...args }, { dataLayer })
const toolError = (name, orgId, args) =>
  tool(name, orgId, args).then(
    () => "",
    (err) => String(err.message)
  )

/** By-key answer equals by-id answer, or names an ambiguity when the key is not unique. */
async function checkByKey(label, name, orgId, id, key, value, table) {
  const dupes = (await raw(table, "id", orgId, { [key]: value })).length
  if (dupes > 1) {
    const msg = await toolError(name, orgId, { [key]: value })
    check(`${label} ${id} by ${key} reports ambiguity`, msg.includes("pass id instead"))
    return
  }
  const [byId, byKey] = await Promise.all([
    tool(name, orgId, { id }),
    tool(name, orgId, { [key]: value }),
  ])
  check(`${label} ${id} by ${key} = by id`, JSON.stringify(byId) === JSON.stringify(byKey))
}

const { rows: orgs } = await dataLayer.listOrganizations({ limit: 100, offset: 0 })
console.log(`${orgs.length} workspace(s) at ${apiUrl}`)

for (const org of orgs) {
  const orgId = String(org.id)
  console.log(`\nworkspace ${orgId}`)

  for (const c of await raw("clients", "id,name,industry", orgId, {}, SAMPLES)) {
    const out = await tool("get_customer", orgId, { id: c.id })
    check(`customer ${c.id}`, out.id === c.id && out.name === c.name && out.industry === c.industry)
    check(`customer ${c.id} hides PII`, !("notes" in out) && !("owner" in out))
    await checkByKey("customer", "get_customer", orgId, c.id, "name", c.name, "clients")
  }

  for (const p of await raw("automation_templates", "id,name,price_satang", orgId, {}, SAMPLES)) {
    const out = await tool("get_product", orgId, { id: p.id })
    const price = p.price_satang === null ? null : Number(p.price_satang)
    check(`product ${p.id}`, out.name === p.name && out.price_satang === price, `price ${out.price_thb}`)
    await checkByKey("product", "get_product", orgId, p.id, "name", p.name, "automation_templates")
  }

  for (const q of await raw("quotes", "id,number,status,total_satang", orgId, {}, SAMPLES)) {
    const out = await tool("get_order", orgId, { id: q.id })
    const items = await raw("quote_items", "amount_satang", orgId, { quote_id: q.id })
    check(
      `order ${q.number}`,
      out.number === q.number && out.status === q.status && out.total_satang === Number(q.total_satang),
      `total ${out.total_thb}`
    )
    check(
      `order ${q.number} items`,
      out.items.length === items.length && sum(out.items, "amount_satang") === sum(items, "amount_satang"),
      `${items.length} item(s)`
    )
    await checkByKey("order", "get_order", orgId, q.id, "number", q.number, "quotes")
  }

  for (const inv of await raw("invoices", "id,number,amount_satang", orgId, {}, SAMPLES)) {
    const out = await tool("get_invoice", orgId, { id: inv.id })
    const [items, payments] = await Promise.all([
      raw("invoice_items", "amount_satang", orgId, { invoice_id: inv.id }),
      raw("payments", "amount_satang", orgId, { invoice_id: inv.id, verification_state: "verified" }),
    ])
    const amount = Number(inv.amount_satang)
    const paid = sum(payments, "amount_satang")
    check(
      `invoice ${inv.number}`,
      out.number === inv.number &&
        out.amount_satang === amount &&
        out.paid_satang === paid &&
        out.outstanding_satang === Math.max(0, amount - paid),
      `${out.status}, amount ${out.amount_thb}, paid ${out.paid_thb}`
    )
    check(`invoice ${inv.number} items`, out.items.length === items.length, `${items.length} item(s)`)
    const listed = (await tool("list_invoices", orgId, { limit: 100 })).items.find((i) => i.id === inv.id)
    if (listed) check(`invoice ${inv.number} status = list_invoices`, listed.status === out.status)
    await checkByKey("invoice", "get_invoice", orgId, inv.id, "number", inv.number, "invoices")
  }

  const missing = randomUUID()
  for (const name of ["get_customer", "get_product", "get_order", "get_invoice"]) {
    const msg = await toolError(name, orgId, { id: missing })
    check(`${name} unknown id is not found`, msg.includes("not found"), msg)
  }
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures ? 1 : 0)
