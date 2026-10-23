import assert from "node:assert/strict"
import { execFileSync, spawn } from "node:child_process"
import { readFileSync } from "node:fs"
import { randomUUID } from "node:crypto"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const container = execFileSync("docker", ["ps", "--filter", `publish=${isolation.api + 1}`, "--format", "{{.Names}}"], { encoding: "utf8" }).trim()
assert.match(container, /^supabase_db_[\w-]+$/)
const org = randomUUID(), owner = randomUUID(), client = randomUUID(), first = randomUUID(), second = randomUUID()
const sql = command => execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"], { input: command, encoding: "utf8" })
const actor = `select set_config('request.jwt.claims','{"role":"authenticated","sub":"${owner}"}',true);set local role authenticated;`
const session = command => new Promise(resolve => {
  const child = spawn("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", "postgres"])
  let output = ""
  child.stdout.on("data", data => { output += data })
  child.stderr.on("data", data => { output += data })
  child.on("close", code => resolve({ code, output }))
  child.stdin.end(`begin;set local statement_timeout='8s';${actor}${command};select pg_sleep(0.3);commit;`)
})
const tap = assertions => {
  const output = sql(`begin;create extension if not exists pgtap with schema extensions;select no_plan();${assertions}select * from finish();rollback;`)
  assert.doesNotMatch(output, /not ok|ERROR|failed \d+ test/)
  process.stdout.write(output)
}

try {
  sql(`begin;insert into auth.users(id,email) values('${owner}','race-${owner}@example.invalid');
    insert into public.organizations(id,name,slug) values('${org}','Finance concurrency','race-${org}');
    insert into public.memberships(org_id,user_id,role) values('${org}','${owner}','owner');
    insert into public.clients(id,org_id,name) values('${client}','${org}','Concurrent buyer');
    insert into public.invoices(id,org_id,client_id,number) values('${first}','${org}','${client}','DRAFT-RACE-1'),('${second}','${org}','${client}','DRAFT-RACE-2');
    insert into public.invoice_items(org_id,invoice_id,description,unit_price_satang) values('${org}','${first}','First',10000),('${org}','${second}','Second',10000);
    ${actor}select public.update_business_profile('${org}','Seller','Address',null,'not_registered');
    select public.issue_invoice(org_id,id,version,gen_random_uuid()) from public.invoices where org_id='${org}';
    select public.submit_customer_payment_claim('${org}','${client}',10000,'[]','Concurrent transfer','${randomUUID()}');
    select public.review_payment_claim_with_evidence('${org}',(select id from public.payment_claims where org_id='${org}'),10000,'Race bank receipt','${randomUUID()}','verified',current_date,'transfer');commit;`)
  const payment = sql(`select id from public.payments where org_id='${org}'`).trim()
  assert.match(payment, /^[0-9a-f-]{36}$/)
  const allocation = (invoice, amount) => `select public.apply_customer_credit('${org}','${client}','[{"invoice_id":"${invoice}","amount_satang":${amount}}]','${randomUUID()}')`
  const competitors = await Promise.all([session(allocation(first, 5000)), session(allocation(second, 7000))])
  assert.deepEqual(competitors.map(r => r.code).sort(), [0, 3])
  assert.match(competitors.find(r => r.code !== 0).output, /Insufficient customer credit/)
  tap(`select is((select count(*) from public.audit_log where org_id='${org}' and action='customer_credit_applied'),1::bigint,'concurrent allocations admit exactly one winner');
    select ok((select sum(paid_satang) from public.invoice_balances where org_id='${org}') in (5000,7000),'losing allocation leaves no partial writes');
    select is((select credit_satang+paid_satang from public.client_balances where client_id='${client}'),10000::bigint,'credit plus allocated cash is conserved');`)
  const reverse = () => `select public.reverse_payment('${org}','${payment}','Concurrent bounced cheque',current_date,'${randomUUID()}')`
  const reversals = await Promise.all([session(reverse()), session(reverse())])
  assert.deepEqual(reversals.map(r => r.code).sort(), [0, 3])
  assert.match(reversals.find(r => r.code !== 0).output, /Unreversed verified receipt required/)
  tap(`select is((select count(*) from public.payments where org_id='${org}' and reversal_of='${payment}'),1::bigint,'concurrent reversal posts one offset');
    select is((select sum(amount_satang)::bigint from public.payments where org_id='${org}' and verification_state='verified'),0::bigint,'concurrent reversal preserves net cash');
    select is((select sum(paid_satang)::bigint from public.invoice_balances where org_id='${org}'),0::bigint,'reversal offsets every winning allocation');
    select is((select credit_satang from public.client_balances where client_id='${client}'),0::bigint,'reversed receipt cannot be spent again');`)
} finally {
  sql(`begin;delete from public.payment_claims where org_id='${org}';delete from public.payment_allocations where org_id='${org}';delete from public.payments where org_id='${org}';delete from public.organizations where id='${org}';delete from auth.users where id='${owner}';commit;`)
}
