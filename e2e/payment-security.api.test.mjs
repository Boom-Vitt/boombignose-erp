import { test, before, after } from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import { createClient } from "@supabase/supabase-js"

// Intentionally fail closed: these adversarial tests never run against a remote DB.
const vars = Object.fromEntries((await readFile(".env.local", "utf8")).trim().split("\n").filter(l => l.includes("=")).map(l => [l.slice(0,l.indexOf("=")),l.slice(l.indexOf("=")+1)]))
const isolation = JSON.parse(await readFile(".local-stack/isolation.json", "utf8"))
assert.equal(vars.NEXT_PUBLIC_SUPABASE_URL, `http://127.0.0.1:${isolation.api}`)
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const orgs = [randomUUID(), randomUUID()]
const users = []
const token = randomUUID() + randomUUID()
let owner, member, client, foreignClient
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data }
before(async () => {
  for (const role of ["owner", "member"]) {
    const email = `erp-${randomUUID()}@example.invalid`
    const password = `LocalOnly-${randomUUID()}!`
    const user = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true })).user
    users.push(user.id)
    for (const org_id of orgs) {
      if (role === "owner") ok(await admin.from("organizations").insert({ id: org_id, name: "Synthetic security fixture", slug: `test-${org_id}` }))
      ok(await admin.from("memberships").insert({ org_id, user_id: user.id, role }))
    }
    const api = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    ok(await api.auth.signInWithPassword({ email, password }))
    if (role === "owner") owner = api
    else member = api
  }
  client = ok(await admin.from("clients").insert({ org_id: orgs[0], name: "Synthetic customer", portal_token: token, portal_enabled: true }).select().single())
  foreignClient = ok(await admin.from("clients").insert({ org_id: orgs[1], name: "Other workspace" }).select().single())
})
after(async () => {
  // Fixtures have unique IDs; no shared demo account, external delivery or real data.
  for (const org of orgs) {
    ok(await admin.from("payment_claims").delete().eq("org_id",org))
    ok(await admin.from("payment_allocations").delete().eq("org_id",org))
    ok(await admin.from("payments").delete().eq("org_id",org))
    ok(await admin.from("organizations").delete().eq("id", org))
  }
  for (const user of users) await admin.auth.admin.deleteUser(user)
})
async function invoice(amount = 10000, status = "sent") {
  return ok(await admin.from("invoices").insert({ org_id: orgs[0], client_id: client.id, number: randomUUID(), amount_satang: amount, status }).select().single())
}
async function claim(inv, amount = inv.amount_satang, key = randomUUID()) {
  return ok(await admin.rpc("submit_payment_claim", { p_token: token, p_invoice_id: inv.id, p_amount_satang: amount, p_reference: "Customer report", p_key: key }))
}
function review(claimId, amount, key, decision = "verified", ref = "bank-statement-test") {
  return { p_org_id: orgs[0], p_claim_id: claimId, p_amount_satang: amount, p_reference: ref, p_key: key, p_decision: decision }
}
test("member cannot insert settlement or forge invoice paid via direct API", async () => {
  const inv = await invoice()
  assert.ok((await member.from("payments").insert({ org_id: orgs[0], invoice_id: inv.id, amount_satang: 10000 })).error)
  const attempt = await member.from("invoices").update({ status: "paid" }).eq("id", inv.id).select("id, status")
  assert.ok(attempt.error || attempt.data?.length === 0, "unauthorized invoice update must fail or affect no visible rows")
  assert.equal(ok(await admin.from("invoices").select("status").eq("id", inv.id).single()).status, "sent")
})
test("multi-org member cannot create a cross-org invoice relationship", async () => {
  assert.ok((await owner.from("invoices").insert({ org_id: orgs[0], client_id: foreignClient.id, number: randomUUID(), amount_satang: 1 })).error)
})
test("portal retries record only one pending claim with no cash effect", async () => {
  const inv = await invoice(), key = randomUUID()
  const [a,b] = await Promise.all([claim(inv,10000,key), claim(inv,10000,key)])
  assert.equal(a,b)
  assert.equal(ok(await admin.from("payment_claims").select().eq("invoice_id",inv.id)).length,1)
  assert.equal(ok(await admin.from("payments").select().eq("invoice_id",inv.id)).length,0)
  assert.equal(ok(await owner.from("invoices").select("status").eq("id",inv.id).single()).status,"sent")
  assert.ok((await anon.rpc("submit_payment_claim", {p_token:token,p_invoice_id:inv.id,p_amount_satang:10000,p_reference:"Customer report",p_key:key})).error)
  assert.ok((await admin.rpc("submit_payment_claim", {p_token:token,p_invoice_id:inv.id,p_amount_satang:9999,p_reference:"Changed",p_key:key})).error)
})
test("only owner/admin can verify; concurrent retry creates one allocation and audit", async () => {
  const inv = await invoice(), c = await claim(inv,4000), key = randomUUID()
  assert.ok((await member.rpc("review_payment_claim",review(c,4000,key))).error)
  const responses = await Promise.all([owner.rpc("review_payment_claim",review(c,4000,key)),owner.rpc("review_payment_claim",review(c,4000,key))])
  assert.equal(ok(responses[0]),ok(responses[1]))
  const payments = ok(await admin.from("payments").select().eq("invoice_id",inv.id))
  assert.equal(payments.length,1)
  assert.equal(payments[0].verification_state,"verified")
  assert.equal(ok(await admin.from("payment_allocations").select().eq("invoice_id",inv.id)).length,1)
  assert.equal(ok(await admin.from("audit_log").select().eq("entity_id",payments[0].id).eq("action","payment_verified")).length,1)
  assert.equal(ok(await owner.from("invoices").select("status").eq("id",inv.id).single()).status,"partially_paid")
  const c2 = await claim(inv,6000)
  ok(await owner.rpc("review_payment_claim",review(c2,6000,randomUUID())))
  assert.equal(ok(await owner.from("invoices").select("status").eq("id",inv.id).single()).status,"paid")
  assert.ok((await owner.rpc("review_payment_claim",review(c,4001,key))).error)
})
test("rejection leaves cash unchanged and disabled/wrong tokens cannot claim", async () => {
  const inv = await invoice(), c = await claim(inv)
  ok(await owner.rpc("review_payment_claim",review(c,0,randomUUID(),"rejected","No matching bank receipt")))
  assert.equal(ok(await admin.from("payments").select().eq("invoice_id",inv.id)).length,0)
  const args = {p_token:randomUUID(),p_invoice_id:inv.id,p_amount_satang:10000,p_reference:"test",p_key:randomUUID()}
  assert.ok((await admin.rpc("submit_payment_claim",args)).error)
  ok(await admin.from("clients").update({portal_enabled:false}).eq("id",client.id))
  assert.ok((await admin.rpc("submit_payment_claim",{...args,p_token:token})).error)
  ok(await admin.from("clients").update({portal_enabled:true}).eq("id",client.id))
})
test("draft/cancelled, excessive and unsafe amounts fail without partial settlement", async () => {
  for (const status of ["draft","cancelled"]) {
    const inv = await invoice(10000,status)
    assert.ok((await admin.rpc("submit_payment_claim",{p_token:token,p_invoice_id:inv.id,p_amount_satang:1,p_reference:"test",p_key:randomUUID()})).error)
  }
  const inv = await invoice(), c = await claim(inv)
  for (const amount of [10001,0,-1,"9007199254740992"]) assert.ok((await owner.rpc("review_payment_claim",review(c,amount,randomUUID()))).error)
  assert.equal(ok(await admin.from("payments").select().eq("invoice_id",inv.id)).length,0)
  assert.equal(ok(await admin.from("payment_claims").select("status").eq("id",c).single()).status,"pending")
})
test("different retry key resolving a pending claim cannot later identify a different request",async()=>{
  const inv=await invoice(), c=await claim(inv), alias=randomUUID()
  assert.equal(await claim(inv,10000,alias),c)
  ok(await owner.rpc("review_payment_claim",review(c,0,randomUUID(),"rejected","No bank match")))
  const second=await invoice()
  assert.ok((await admin.rpc("submit_payment_claim",{p_token:token,p_invoice_id:second.id,p_amount_satang:10000,p_reference:"Customer report",p_key:alias})).error)
})
test("direct member cannot forge a trusted payment verification audit",async()=>{
  assert.ok((await member.from("audit_log").insert({org_id:orgs[0],actor_id:users[0],entity:"payment",entity_id:randomUUID(),action:"payment_verified",summary:"Forged receipt evidence"})).error)
})
test("verified invoice lines cannot mutate and a fully settled invoice cannot become overdue",async()=>{
  const inv=await invoice(), c=await claim(inv,4000)
  ok(await owner.rpc("review_payment_claim",review(c,4000,randomUUID())))
  assert.ok((await owner.from("invoice_items").insert({org_id:orgs[0],invoice_id:inv.id,description:"Changed charge",quantity:1,unit_price_satang:50000,amount_satang:50000})).error)
  assert.equal(ok(await admin.from("invoice_items").select().eq("invoice_id",inv.id)).length,0)
  const c2=await claim(inv,6000)
  ok(await owner.rpc("review_payment_claim",review(c2,6000,randomUUID())))
  assert.ok((await owner.from("invoices").update({status:"overdue"}).eq("id",inv.id)).error)
})
test("pending customer claim prevents reassignment to another customer",async()=>{
  const inv=await invoice(); await claim(inv)
  const other=ok(await admin.from("clients").insert({org_id:orgs[0],name:"Other customer"}).select().single())
  assert.ok((await member.from("invoices").update({client_id:other.id}).eq("id",inv.id)).error)
})
test("line mutation and authoritative header total commit together before settlement",async()=>{
  const inv=await invoice()
  ok(await owner.from("invoice_items").insert({org_id:orgs[0],invoice_id:inv.id,description:"Actual line",quantity:1,unit_price_satang:9000,amount_satang:1}))
  assert.equal(ok(await owner.from("invoices").select("amount_satang").eq("id",inv.id).single()).amount_satang,9000)
  assert.equal(ok(await owner.from("invoice_items").select("amount_satang").eq("invoice_id",inv.id).single()).amount_satang,9000)
})
