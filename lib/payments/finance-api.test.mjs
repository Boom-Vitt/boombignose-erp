import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

// Fail closed: synthetic fixtures only in this worktree's configured local stack.
const isolation = JSON.parse(await readFile(".local-stack/isolation.json", "utf8"))
const env = Object.fromEntries((await readFile(".env.local", "utf8")).split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `http://127.0.0.1:${isolation.api}`)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options)
const orgs = [randomUUID(), randomUUID()], users = []
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data }
let owner, member, client
before(async () => {
  for (const org of orgs) ok(await admin.from("organizations").insert({ id: org, name: "Synthetic finance fixture", slug: `finance-${org}` }))
  for (const role of ["owner", "member"]) {
    const email = `finance-${randomUUID()}@example.invalid`, password = `Local-${randomUUID()}!`
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user
    users.push(user.id)
    for (const org of orgs) ok(await admin.from("memberships").insert({ org_id: org, user_id: user.id, role }))
    const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    ok(await api.auth.signInWithPassword({ email, password }))
    if (role === "owner") owner = api; else member = api
  }
  client = ok(await admin.from("clients").insert({ org_id: orgs[0], name: "ลูกค้าทดลอง", billing_address: "ที่อยู่ทดลอง", tax_id: null }).select().single())
  ok(await owner.rpc("update_business_profile", { p_org_id: orgs[0], p_legal_name: "กิจการทดสอบ", p_business_address: "ที่อยู่กิจการ", p_tax_id: null, p_tax_status: "unknown" }))
})
after(async () => {
  for (const org of orgs) ok(await admin.from("organizations").delete().eq("id", org))
  for (const user of users) ok(await admin.auth.admin.deleteUser(user))
})
async function draft() {
  const invoice = ok(await owner.from("invoices").insert({ org_id: orgs[0], client_id: client.id, number: `DRAFT-${randomUUID()}`, status: "draft", amount_satang: 0, discount_satang: 100, issue_date: "2025-01-31", due_date: "2025-02-28" }).select().single())
  ok(await owner.from("invoice_items").insert({ org_id: orgs[0], invoice_id: invoice.id, description: "งานทดลอง", quantity: 1.005, unit_price_satang: 10000, amount_satang: 1, position: 0 }))
  return ok(await owner.from("invoices").select().eq("id", invoice.id).eq("org_id", orgs[0]).single())
}
async function issued() {
  const invoice = await draft()
  ok(await owner.rpc("issue_invoice", { p_org_id: orgs[0], p_invoice_id: invoice.id, p_expected_version: invoice.version, p_key: randomUUID() }))
  return ok(await owner.from("invoices").select().eq("id", invoice.id).single())
}
test("issuance protects versions, snapshots and discounted priced lines under retry", async () => {
  const invoice = await draft(), key = randomUUID()
  const args = { p_org_id: orgs[0], p_invoice_id: invoice.id, p_expected_version: invoice.version, p_key: key }
  assert.ok((await owner.rpc("issue_invoice", { ...args, p_expected_version: invoice.version - 1 })).error)
  assert.equal(ok(await admin.from("invoice_snapshots").select().eq("invoice_id", invoice.id)).length, 0)
  const results = await Promise.all([owner.rpc("issue_invoice", args), owner.rpc("issue_invoice", args)])
  assert.equal(ok(results[0]), ok(results[1]))
  const snapshots = ok(await admin.from("invoice_snapshots").select().eq("invoice_id", invoice.id))
  assert.equal(snapshots.length, 1)
  assert.equal(snapshots[0].snapshot.version, 1)
  assert.equal(snapshots[0].snapshot.document.totalSatang, 9950)
  assert.equal(snapshots[0].snapshot.document.discountSatang, 100)
  assert.ok((await owner.from("invoices").update({ amount_satang: 1 }).eq("id", invoice.id)).error)
  assert.ok((await owner.from("invoice_items").insert({ org_id: orgs[0], invoice_id: invoice.id, description: "Changed", quantity: 1, unit_price_satang: 1, amount_satang: 1 })).error)
  ok(await owner.rpc("update_business_profile", { p_org_id: orgs[0], p_legal_name: "Changed live seller", p_business_address: "New live address", p_tax_id: null, p_tax_status: "unknown" }))
  assert.equal(ok(await admin.from("invoice_snapshots").select("snapshot").eq("id", snapshots[0].id).single()).snapshot.seller.legalName, "กิจการทดสอบ")
})
test("staff pending report has zero cash until evidence-date verification, concurrent retries create one receipt", async () => {
  const invoice = await issued(), key = randomUUID()
  const args = { p_org_id: orgs[0], p_invoice_id: invoice.id, p_amount_satang: 101, p_reference: "Staff transfer report", p_key: key }
  const results = await Promise.all([owner.rpc("submit_internal_payment_claim", args), owner.rpc("submit_internal_payment_claim", args)])
  const claim = ok(results[0]); assert.equal(claim, ok(results[1]))
  assert.equal(ok(await admin.from("payments").select().eq("invoice_id", invoice.id)).length, 0)
  const verify = { p_org_id: orgs[0], p_claim_id: claim, p_amount_satang: 101, p_reference: "BANK-2025-01-31-101", p_key: randomUUID(), p_decision: "verified", p_paid_on: "2025-01-31", p_method: "promptpay" }
  const verified = await Promise.all([owner.rpc("review_payment_claim_with_evidence", verify), owner.rpc("review_payment_claim_with_evidence", verify)])
  assert.equal(ok(verified[0]), ok(verified[1]))
  const receipts = ok(await admin.from("payments").select().eq("invoice_id", invoice.id))
  assert.equal(receipts.length, 1)
  assert.equal(receipts[0].amount_satang, 101)
  assert.equal(receipts[0].method, "promptpay")
  assert.equal(new Date(receipts[0].paid_at).toISOString(), "2025-01-30T17:00:00.000Z")
  assert.equal(ok(await admin.from("payment_allocations").select().eq("invoice_id", invoice.id)).length, 1)
  assert.equal(ok(await admin.from("invoices").select("status").eq("id", invoice.id).single()).status, "partially_paid")
})
test("legacy reconciliation retains the original and links one new verified receipt under retries", async () => {
  const invoice = await issued()
  const legacy = ok(await admin.from("payments").insert({ org_id: orgs[0], invoice_id: invoice.id, amount_satang: 5000, notes: "Untrusted original portal record", paid_at: "2025-01-01T00:00:00Z", method: "transfer" }).select().single())
  const args = { p_org_id: orgs[0], p_legacy_payment_id: legacy.id, p_amount_satang: 4000, p_reference: "BANK-LEGACY-4000", p_key: randomUUID(), p_paid_on: "2025-01-31", p_method: "transfer" }
  const results = await Promise.all([owner.rpc("reconcile_legacy_payment_with_evidence", args), owner.rpc("reconcile_legacy_payment_with_evidence", args)])
  const receipt = ok(results[0]); assert.equal(receipt, ok(results[1]))
  assert.notEqual(receipt, legacy.id)
  const original = ok(await admin.from("payments").select().eq("id", legacy.id).single())
  assert.equal(original.amount_satang, 5000)
  assert.equal(original.notes, legacy.notes)
  assert.equal(original.reconciled_payment_id, receipt)
  assert.equal(original.verification_state, "legacy_reconciled")
  assert.equal(ok(await admin.from("payments").select().eq("invoice_id", invoice.id).eq("verification_state", "verified")).length, 1)
  assert.ok((await owner.rpc("reconcile_legacy_payment_with_evidence", { ...args, p_amount_satang: 4001 })).error)
})
test("member and cross-org commands cannot issue, report or reconcile financial evidence", async () => {
  const invoice = await draft()
  const issue = { p_org_id: orgs[0], p_invoice_id: invoice.id, p_expected_version: invoice.version, p_key: randomUUID() }
  assert.ok((await member.rpc("issue_invoice", issue)).error)
  assert.ok((await owner.rpc("issue_invoice", { ...issue, p_org_id: orgs[1] })).error)
  const report = { p_org_id: orgs[0], p_invoice_id: invoice.id, p_amount_satang: 101, p_reference: "Forged", p_key: randomUUID() }
  assert.ok((await member.rpc("submit_internal_payment_claim", report)).error)
  assert.ok((await owner.rpc("submit_internal_payment_claim", { ...report, p_org_id: orgs[1] })).error)
})
