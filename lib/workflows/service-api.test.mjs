import { after, before, test } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile, realpath } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"
import { assertServiceTestIsolation } from "./service-isolation.mjs"

// Explicit runner: node --test lib/workflows/service-api.test.mjs.
// This acceptance suite connects only to this worktree's generated local lane.
const isolation = JSON.parse(await readFile(".local-stack/isolation.json", "utf8"))
const vars = Object.fromEntries((await readFile(".env.local", "utf8"))
  .split("\n").filter((line) => line.includes("="))
  .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
const root = await realpath(process.cwd())
const config = await readFile(".local-stack/supabase/config.toml", "utf8")
const configProject = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1]
assertServiceTestIsolation(isolation, root, vars.NEXT_PUBLIC_SUPABASE_URL, configProject)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const orgs = [randomUUID(), randomUUID()]
const users = []
let owner, member, customer, foreignCustomer

function ok(result) {
  assert.equal(result.error, null, result.error?.message)
  return result.data
}

before(async () => {
  for (const orgId of orgs) {
    ok(await admin.from("organizations").insert({ id: orgId, name: "Synthetic services acceptance", slug: `service-${orgId}` }))
  }
  for (const role of ["owner", "member"]) {
    const email = `services-${randomUUID()}@example.invalid`
    const password = `LocalOnly-${randomUUID()}!`
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user
    users.push(user.id)
    for (const orgId of orgs) ok(await admin.from("memberships").insert({ org_id: orgId, user_id: user.id, role }))
    const api = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    ok(await api.auth.signInWithPassword({ email, password }))
    if (role === "owner") owner = api
    else member = api
  }
  customer = ok(await owner.from("clients").insert({ org_id: orgs[0], name: "Synthetic service customer" }).select().single())
  foreignCustomer = ok(await owner.from("clients").insert({ org_id: orgs[1], name: "Foreign synthetic customer" }).select().single())
})

after(async () => {
  const failures = []
  for (const orgId of orgs) {
    try { ok(await admin.from("organizations").delete().eq("id", orgId)) }
    catch (error) { failures.push(error) }
  }
  for (const userId of users) {
    try { ok(await admin.auth.admin.deleteUser(userId)) }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, "Synthetic fixture cleanup failed")
})

async function quoteFixture({
  accepted = true, projectId = null, orgId = orgs[0], clientId = customer.id, discount = 1000,
  items = [{ description: "Agreed service scope", quantity: 1, unit_price_satang: 10000 }],
} = {}) {
  const quote = ok(await owner.from("quotes").insert({
    org_id: orgId, client_id: clientId, project_id: projectId,
    number: `QUO-${randomUUID()}`, discount_satang: discount,
    valid_until: "2099-12-31", status: "draft",
  }).select().single())
  ok(await owner.from("quote_items").insert(items.map((item, position) => ({
    ...item, org_id: orgId, quote_id: quote.id, amount_satang: 1, position,
  }))))
  if (accepted) {
    ok(await owner.from("quotes").update({ status: "sent" }).eq("id", quote.id))
    ok(await owner.from("quotes").update({ status: "accepted" }).eq("id", quote.id))
  }
  return quote
}

function conversion(quoteId, key = randomUUID(), orgId = orgs[0]) {
  return { p_org_id: orgId, p_quote_id: quoteId, p_key: key }
}

test("direct API rejects anonymous/member conversion and unaccepted quotes without partial records", async () => {
  const draft = await quoteFixture({ accepted: false })
  assert.ok((await owner.rpc("convert_accepted_quote", conversion(draft.id))).error)
  const accepted = await quoteFixture()
  assert.ok((await member.rpc("convert_accepted_quote", conversion(accepted.id))).error)
  assert.ok((await anon.rpc("convert_accepted_quote", conversion(accepted.id))).error)
  for (const quoteId of [draft.id, accepted.id]) {
    assert.equal(ok(await owner.from("invoices").select("id").eq("source_quote_id", quoteId)).length, 0)
    assert.equal(ok(await owner.from("milestones").select("id").eq("source_quote_id", quoteId)).length, 0)
    assert.equal(ok(await owner.from("projects").select("id").eq("source_quote_id", quoteId)).length, 0)
  }
})

test("concurrent same and alternate keys return one complete discounted service workflow", async () => {
  const quote = await quoteFixture({ items: [
    { description: "Agreed service scope", quantity: 1, unit_price_satang: 10000 },
    { description: "Fractional service", quantity: 1.005, unit_price_satang: 100 },
  ] })
  const key = randomUUID()
  const requests = [key, key, randomUUID(), randomUUID()]
  const results = await Promise.all(requests.map((requestKey) => owner.rpc("convert_accepted_quote", conversion(quote.id, requestKey))))
  const invoiceId = ok(results[0])
  for (const result of results) assert.equal(ok(result), invoiceId)
  const invoices = ok(await owner.from("invoices").select().eq("org_id", orgs[0]).eq("source_quote_id", quote.id))
  assert.equal(invoices.length, 1)
  const invoice = invoices[0]
  assert.equal(invoice.id, invoiceId)
  assert.equal(invoice.status, "draft")
  assert.equal(invoice.discount_satang, 1000)
  assert.equal(invoice.amount_satang, 9101)
  assert.equal(invoice.client_id, customer.id)
  const milestones = ok(await owner.from("milestones").select().eq("org_id", orgs[0]).eq("source_quote_id", quote.id))
  assert.equal(milestones.length, 1)
  assert.equal(invoice.source_milestone_id, milestones[0].id)
  assert.equal(milestones[0].project_id, invoice.project_id)
  const project = ok(await owner.from("projects").select().eq("org_id", orgs[0]).eq("id", invoice.project_id).single())
  assert.equal(project.source_quote_id, quote.id)
  assert.equal(project.client_id, customer.id)
  assert.equal(ok(await owner.from("projects").select("id").eq("org_id", orgs[0]).eq("source_quote_id", quote.id)).length, 1)
  const converted = ok(await owner.from("quotes").select().eq("org_id", orgs[0]).eq("id", quote.id).single())
  assert.equal(converted.status, "converted")
  assert.equal(converted.project_id, project.id)
  assert.equal(converted.converted_invoice_id, invoiceId)
  const lines = ok(await owner.from("invoice_items").select().eq("org_id", orgs[0]).eq("invoice_id", invoiceId).order("position"))
  assert.equal(lines.length, 2)
  assert.equal(lines[0].description, "Agreed service scope")
  assert.equal(lines[0].quantity, 1)
  assert.equal(lines[0].unit_price_satang, 10000)
  assert.equal(lines[0].amount_satang, 10000)
  assert.equal(lines[1].description, "Fractional service")
  assert.equal(lines[1].quantity, 1.005)
  assert.equal(lines[1].unit_price_satang, 100)
  assert.equal(lines[1].amount_satang, 101)
  assert.ok(ok(await owner.from("audit_log").select("id").eq("org_id", orgs[0]).eq("entity_id", quote.id)).length > 0)
  for (const requestKey of requests) assert.equal(ok(await owner.rpc("convert_accepted_quote", conversion(quote.id, requestKey))), invoiceId)
})

test("a successful key cannot identify a different quote on retry", async () => {
  const first = await quoteFixture(), second = await quoteFixture(), key = randomUUID()
  const invoiceId = ok(await owner.rpc("convert_accepted_quote", conversion(first.id, key)))
  assert.ok((await owner.rpc("convert_accepted_quote", conversion(second.id, key))).error)
  const alias = randomUUID()
  assert.equal(ok(await owner.rpc("convert_accepted_quote", conversion(first.id, alias))), invoiceId)
  assert.ok((await owner.rpc("convert_accepted_quote", conversion(second.id, alias))).error)
  assert.equal(ok(await owner.rpc("convert_accepted_quote", conversion(first.id, key))), invoiceId)
  assert.equal(ok(await owner.from("invoices").select("id").eq("source_quote_id", second.id)).length, 0)
})

test("expired quotes cannot be accepted and incomplete quotes cannot be sent", async () => {
  const expired = ok(await owner.from("quotes").insert({ org_id: orgs[0], client_id: customer.id, number: randomUUID(), valid_until: "2000-01-01" }).select().single())
  ok(await owner.from("quote_items").insert({ org_id: orgs[0], quote_id: expired.id, description: "Expired scope", quantity: 1, unit_price_satang: 100, amount_satang: 100 }))
  // The database can reject the expired quote at send or acceptance; either
  // leaves it ineligible for conversion and cannot create partial documents.
  await owner.from("quotes").update({ status: "sent" }).eq("id", expired.id)
  assert.ok((await owner.from("quotes").update({ status: "accepted" }).eq("id", expired.id)).error)
  assert.ok((await owner.rpc("convert_accepted_quote", conversion(expired.id))).error)
  const empty = ok(await owner.from("quotes").insert({ org_id: orgs[0], client_id: customer.id, number: randomUUID() }).select().single())
  assert.ok((await owner.from("quotes").update({ status: "sent" }).eq("id", empty.id)).error)
  assert.equal(ok(await owner.from("invoices").select("id").in("source_quote_id", [expired.id, empty.id])).length, 0)
})

test("accepted scope is frozen and converted status cannot be set directly", async () => {
  const quote = await quoteFixture()
  assert.ok((await owner.from("quotes").update({ notes: "Changed agreed scope" }).eq("id", quote.id)).error)
  assert.ok((await owner.from("quote_items").update({ quantity: 2 }).eq("quote_id", quote.id)).error)
  assert.ok((await owner.from("quote_items").delete().eq("quote_id", quote.id)).error)
  assert.ok((await owner.from("quotes").update({ status: "converted" }).eq("id", quote.id)).error)
  assert.equal(ok(await owner.from("quote_items").select("amount_satang").eq("quote_id", quote.id).single()).amount_satang, 10000)
})

test("conversion reuses a same-client project and adds one source milestone", async () => {
  const project = ok(await owner.from("projects").insert({ org_id: orgs[0], client_id: customer.id, name: "Existing synthetic project" }).select().single())
  const quote = await quoteFixture({ projectId: project.id })
  const invoiceId = ok(await owner.rpc("convert_accepted_quote", conversion(quote.id)))
  const invoice = ok(await owner.from("invoices").select("project_id").eq("id", invoiceId).single())
  assert.equal(invoice.project_id, project.id)
  assert.equal(ok(await owner.from("milestones").select("id").eq("project_id", project.id).eq("source_quote_id", quote.id)).length, 1)
})

test("tenant-qualified source links reject foreign quotes even for a multi-org owner", async () => {
  const foreignQuote = await quoteFixture({ orgId: orgs[1], clientId: foreignCustomer.id })
  assert.ok((await owner.from("projects").insert({ org_id: orgs[0], client_id: customer.id, name: "Cross tenant source", source_quote_id: foreignQuote.id })).error)
  const project = ok(await owner.from("projects").insert({ org_id: orgs[0], client_id: customer.id, name: "Local project" }).select().single())
  assert.ok((await owner.from("milestones").insert({ org_id: orgs[0], project_id: project.id, title: "Cross tenant source", source_quote_id: foreignQuote.id })).error)
  assert.ok((await owner.from("invoices").insert({ org_id: orgs[0], client_id: customer.id, number: randomUUID(), source_quote_id: foreignQuote.id })).error)
  assert.ok((await owner.rpc("convert_accepted_quote", conversion(foreignQuote.id))).error)
})
