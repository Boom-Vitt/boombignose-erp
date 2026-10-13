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
test("direct member CRUD cannot bypass protected deletion, invitation and settings roles",async()=>{
  const fresh=ok(await admin.from("clients").insert({org_id:orgs[0],name:"Protected client"}).select().single())
  const deleted=await member.from("clients").delete().eq("id",fresh.id).select()
  assert.equal(deleted.data?.length??0,0)
  assert.ok((await member.from("invitations").insert({org_id:orgs[0],email:"test@example.invalid",token:randomUUID()})).error)
  assert.ok((await member.from("org_settings").insert({org_id:orgs[0],cash_balance_satang:123})).error)
  assert.equal(ok(await owner.from("clients").delete().eq("id",fresh.id).select()).length,1)
})
test("all tested parent references reject a member belonging to both organizations",async()=>{
  const project=ok(await admin.from("projects").insert({org_id:orgs[1],client_id:foreignClient.id,name:"Foreign project"}).select().single())
  const deal=ok(await admin.from("deals").insert({org_id:orgs[1],client_id:foreignClient.id,title:"Foreign deal"}).select().single())
  const cases=[
    ["contacts",{client_id:foreignClient.id,name:"Cross org"}],
    ["deals",{client_id:foreignClient.id,title:"Cross org"}],
    ["activities",{deal_id:deal.id,body:"Cross org"}],
    ["projects",{client_id:foreignClient.id,name:"Cross org"}],
    ["project_tasks",{project_id:project.id,title:"Cross org"}],
    ["milestones",{project_id:project.id,title:"Cross org"}],
    ["quotes",{client_id:foreignClient.id,number:randomUUID()}],
    ["subscriptions",{client_id:foreignClient.id,name:randomUUID()}],
    ["invoices",{client_id:client.id,project_id:project.id,number:randomUUID()}],
  ]
  for(const [table,fields] of cases) assert.ok((await owner.from(table).insert({org_id:orgs[0],...fields})).error,table)
})
test("tenant reassignment remains forbidden even for a member of both organizations",async()=>{
  assert.ok((await owner.from("clients").update({org_id:orgs[1]}).eq("id",client.id)).error)
})
test("nullable tenant parent keeps org when ON DELETE SET NULL runs",async()=>{
  const c=ok(await admin.from("clients").insert({org_id:orgs[0],name:"Temporary parent"}).select().single())
  const p=ok(await admin.from("projects").insert({org_id:orgs[0],client_id:c.id,name:"Keep project"}).select().single())
  ok(await owner.from("clients").delete().eq("id",c.id))
  const remaining=ok(await owner.from("projects").select("org_id,client_id").eq("id",p.id).single())
  assert.equal(remaining.org_id,orgs[0]); assert.equal(remaining.client_id,null)
})
test("workspace provisioning is authenticated and concurrency/idempotency safe",async()=>{
  assert.ok((await anon.rpc("provision_workspace",{p_name:"New workspace",p_key:randomUUID()})).error)
  const key=randomUUID()
  const results=await Promise.all([owner.rpc("provision_workspace",{p_name:"New workspace",p_key:key}),owner.rpc("provision_workspace",{p_name:"New workspace",p_key:key})])
  const id=ok(results[0]);orgs.push(id); assert.equal(ok(results[1]),id)
  assert.equal(ok(await admin.from("memberships").select().eq("org_id",id)).length,1)
  assert.ok((await owner.rpc("provision_workspace",{p_name:"Changed workspace",p_key:key})).error)
})
test("invitation acceptance checks intended recipient and preserves existing roles on retry",async()=>{
  const email=ok(await admin.auth.admin.getUserById(users[1])).user.email
  const invite=ok(await owner.from("invitations").insert({org_id:orgs[0],email,role:"admin",token:randomUUID(),expires_at:"2099-01-01"}).select().single())
  assert.ok((await owner.rpc("accept_workspace_invitation",{p_token:invite.token})).error)
  assert.equal(ok(await member.rpc("accept_workspace_invitation",{p_token:invite.token})),orgs[0])
  assert.equal(ok(await member.rpc("accept_workspace_invitation",{p_token:invite.token})),orgs[0])
  assert.equal(ok(await admin.from("memberships").select("role").eq("org_id",orgs[0]).eq("user_id",users[1]).single()).role,"member")
  const expired=ok(await owner.from("invitations").update({token:randomUUID(),status:"pending",accepted_by:null,expires_at:"2000-01-01"}).eq("id",invite.id).select().single())
  assert.ok((await member.rpc("accept_workspace_invitation",{p_token:expired.token})).error)
})
