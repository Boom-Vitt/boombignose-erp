import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { createClient } from '@supabase/supabase-js'

// Explicit local-only runner: node --test lib/automation/reliability-api.test.mjs
const isolation = JSON.parse(await readFile('.local-stack/isolation.json', 'utf8'))
assert.equal(isolation.root, await realpath(process.cwd()))
assert.equal(isolation.api, 55501)
assert.equal(isolation.db, 55502)
assert.equal(isolation.app, 3105)
const vars = Object.fromEntries((await readFile('.env.local', 'utf8')).split('\n')
  .filter(line => line.includes('='))
  .map(line => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]))
assert.equal(vars.NEXT_PUBLIC_SUPABASE_URL, 'http://127.0.0.1:55501')
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.SUPABASE_SERVICE_ROLE_KEY, options)
const anon = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const orgs = [randomUUID(), randomUUID()]
const users = []
let owner, member, client, foreignClient
const ok = result => { assert.equal(result.error, null, result.error?.message); return result.data }

before(async () => {
  for (const orgId of orgs) ok(await service.from('organizations').insert({ id: orgId, name: 'Synthetic automation acceptance', slug: `automation-${orgId}` }))
  for (const role of ['owner', 'member']) {
    const email = `automation-${randomUUID()}@example.invalid`
    const password = `LocalOnly-${randomUUID()}!`
    const user = ok(await service.auth.admin.createUser({ email, password, email_confirm: true })).user
    users.push(user.id)
    for (const orgId of orgs) ok(await service.from('memberships').insert({ org_id: orgId, user_id: user.id, role }))
    const api = createClient(vars.NEXT_PUBLIC_SUPABASE_URL, vars.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    ok(await api.auth.signInWithPassword({ email, password }))
    if (role === 'owner') owner = api
    else member = api
  }
  client = ok(await owner.from('clients').insert({ org_id: orgs[0], name: 'Synthetic automation customer' }).select().single())
  foreignClient = ok(await owner.from('clients').insert({ org_id: orgs[1], name: 'Foreign synthetic customer' }).select().single())
})
after(async () => {
  const failures = []
  for (const orgId of orgs) try { ok(await service.from('organizations').delete().eq('id', orgId)) } catch (error) { failures.push(error) }
  for (const userId of users) try { ok(await service.auth.admin.deleteUser(userId)) } catch (error) { failures.push(error) }
  if (failures.length) throw new AggregateError(failures, 'Synthetic fixture cleanup failed')
})

async function dueDeal(orgId = orgs[0]) {
  return ok(await owner.from('deals').insert({ org_id: orgId, title: 'Synthetic follow up', stage: 'proposal', next_follow_up_date: '2026-07-02' }).select().single())
}
const specsFor = deal => [{ entity: 'deal', entityId: deal.id, title: deal.title, dueDate: deal.next_follow_up_date }]
const enqueue = (deal, api = owner, specs = specsFor(deal)) => api.rpc('enqueue_reminders', { p_org_id: orgs[0], p_specs: specs })
async function subscription(over = {}) {
  return ok(await owner.from('subscriptions').insert({ org_id: orgs[0], client_id: client.id, name: 'Same retainer name', amount_satang: 101, interval: 'weekly', start_date: '2026-07-02', next_run_date: '2026-07-02', auto_generate: true, status: 'active', ...over }).select().single())
}
const generate = (sub, date = sub.next_run_date, api = owner, orgId = orgs[0]) => api.rpc('generate_subscription_occurrence', { p_org_id: orgId, p_subscription_id: sub.id, p_occurrence: date })
const schedule = async sub => ok(await owner.from('subscriptions').select('next_run_date,last_generated_on').eq('id', sub.id).eq('org_id', orgs[0]).single())
const displayNumber = (sub, date) => `SUB-${sub.id}-${date.replaceAll('-', '')}`

// All scenarios use unique source records; the runner is serial and local-only.
test('direct APIs deny member/anonymous commands and service-only integration operations', async () => {
  const deal = await dueDeal()
  const sub = await subscription()
  for (const api of [member, anon]) {
    assert.ok((await enqueue(deal, api)).error)
    assert.ok((await generate(sub, sub.next_run_date, api)).error)
  }
  for (const api of [owner, member, anon]) {
    assert.ok((await api.rpc('claim_outbound_events', { p_limit: 1, p_lease_seconds: 120 })).error)
    assert.ok((await api.rpc('finish_outbound_event', { p_event_id: randomUUID(), p_lease_token: randomUUID(), p_error: null })).error)
    assert.ok((await api.rpc('accept_integration_event', { p_org_id: orgs[0], p_event_type: 'followup', p_key: randomUUID(), p_payload: {} })).error)
  }
  assert.equal(ok(await owner.from('reminders').select('id').eq('org_id', orgs[0]).eq('entity_id', deal.id)).length, 0)
  assert.equal((await schedule(sub)).next_run_date, '2026-07-02')
})

test('invalid cross-org reminder source rolls back the whole batch', async () => {
  const local = await dueDeal()
  const foreign = await dueDeal(orgs[1])
  assert.ok((await enqueue(local, owner, [...specsFor(local), ...specsFor(foreign)])).error)
  assert.equal(ok(await owner.from('reminders').select('id').eq('org_id', orgs[0]).eq('entity_id', local.id)).length, 0)
  const valid = ok(await enqueue(local))
  assert.equal(valid.remindersUpserted, 1)
  assert.equal(valid.eventsQueued, 1)
})

test('concurrent reminder commands create one event and repair a legacy orphan exactly once', async () => {
  const deal = await dueDeal()
  const results = await Promise.all(Array.from({ length: 4 }, () => enqueue(deal)))
  assert.equal(results.map(ok).reduce((sum, value) => sum + value.remindersUpserted, 0), 1)
  assert.equal(results.map(ok).reduce((sum, value) => sum + value.eventsQueued, 0), 1)
  const reminder = ok(await owner.from('reminders').select().eq('org_id', orgs[0]).eq('entity_id', deal.id).single())
  const events = ok(await service.from('outbound_events').select().eq('org_id', orgs[0]).contains('payload', { reminderId: reminder.id }))
  assert.equal(events.length, 1)
  ok(await service.from('outbound_events').delete().eq('id', events[0].id).eq('org_id', orgs[0]))
  assert.deepEqual(ok(await enqueue(deal)), { remindersUpserted: 0, eventsQueued: 1 })
  assert.deepEqual(ok(await enqueue(deal)), { remindersUpserted: 0, eventsQueued: 0 })
  assert.equal(ok(await service.from('outbound_events').select('id').eq('org_id', orgs[0]).contains('payload', { reminderId: reminder.id })).length, 1)
})

test('concurrent duplicate billing returns one invoice; weekly periods, names and renames do not collide', async () => {
  const sub = await subscription()
  const results = await Promise.all(Array.from({ length: 4 }, () => generate(sub)))
  const invoiceId = ok(results[0])
  for (const result of results) assert.equal(ok(result), invoiceId)
  assert.deepEqual(await schedule(sub), { next_run_date: '2026-07-09', last_generated_on: '2026-07-02' })
  const invoice = ok(await owner.from('invoices').select().eq('id', invoiceId).eq('org_id', orgs[0]).single())
  assert.equal(invoice.number, displayNumber(sub, '2026-07-02'))
  assert.equal(invoice.amount_satang, 101)
  assert.equal(invoice.issue_date, '2026-07-02')
  assert.equal(ok(await owner.from('invoice_items').select('id').eq('invoice_id', invoiceId).eq('org_id', orgs[0])).length, 1)
  ok(await owner.from('subscriptions').update({ name: 'Renamed retainer' }).eq('id', sub.id).eq('org_id', orgs[0]))
  assert.equal(ok(await generate(sub)), invoiceId)
  const second = ok(await generate(sub, '2026-07-09'))
  assert.notEqual(second, invoiceId)
  assert.equal((await schedule(sub)).next_run_date, '2026-07-16')
  const sameName = await subscription()
  assert.notEqual(ok(await generate(sameName)), invoiceId)
  assert.equal(ok(await owner.from('invoices').select('id').eq('org_id', orgs[0]).eq('number', displayNumber(sub, '2026-07-02'))).length, 1)
})

test('invalid occurrence/tenant/cadence command leaves invoice and schedule unchanged', async () => {
  assert.ok((await owner.from('subscriptions').insert({ org_id: orgs[0], client_id: foreignClient.id, name: 'Cross-org rejected', amount_satang: 101, interval: 'weekly' })).error)
  const sub = await subscription()
  assert.ok((await generate(sub, '2026-07-09')).error)
  assert.ok((await generate(sub, sub.next_run_date, owner, orgs[1])).error)
  ok(await owner.from('subscriptions').update({ status: 'paused' }).eq('id', sub.id).eq('org_id', orgs[0]))
  assert.ok((await generate(sub)).error)
  assert.equal((await schedule(sub)).next_run_date, '2026-07-02')
  assert.equal(ok(await owner.from('invoices').select('id').eq('org_id', orgs[0]).eq('number', displayNumber(sub, sub.next_run_date))).length, 0)
})

test('delayed monthly/quarterly/yearly billing advances one period with original start-day recovery', async () => {
  const monthly = await subscription({ interval: 'monthly', start_date: '2026-01-31', next_run_date: '2026-01-31' })
  ok(await generate(monthly))
  assert.equal((await schedule(monthly)).next_run_date, '2026-02-28')
  ok(await generate(monthly, '2026-02-28'))
  assert.equal((await schedule(monthly)).next_run_date, '2026-03-31')
  const quarterly = await subscription({ interval: 'quarterly', start_date: '2025-08-31', next_run_date: '2025-08-31' })
  ok(await generate(quarterly))
  assert.equal((await schedule(quarterly)).next_run_date, '2025-11-30')
  ok(await generate(quarterly, '2025-11-30'))
  assert.equal((await schedule(quarterly)).next_run_date, '2026-02-28')
  ok(await generate(quarterly, '2026-02-28'))
  assert.equal((await schedule(quarterly)).next_run_date, '2026-05-31')
  const yearly = await subscription({ interval: 'yearly', start_date: '2020-02-29', next_run_date: '2020-02-29' })
  for (const date of ['2020-02-29', '2021-02-28', '2022-02-28', '2023-02-28']) ok(await generate(yearly, date))
  assert.equal((await schedule(yearly)).next_run_date, '2024-02-29')
})

test('durable outbox lease expiry permits reclaim with the same event ID and rejects stale ack', async () => {
  const deal = await dueDeal()
  ok(await enqueue(deal))
  // Restrict claims to this local fixture org by making unrelated fixture events
  // unavailable first. This never touches another lane/production data.
  ok(await service.from('outbound_events').update({ next_attempt_at: '2099-01-01T00:00:00Z' }).eq('org_id', orgs[0]))
  const reminder = ok(await owner.from('reminders').select('id').eq('org_id', orgs[0]).eq('entity_id', deal.id).single())
  const event = ok(await service.from('outbound_events').select('id').eq('org_id', orgs[0]).contains('payload', { reminderId: reminder.id }).single())
  ok(await service.from('outbound_events').update({ next_attempt_at: '2000-01-01T00:00:00Z' }).eq('id', event.id).eq('org_id', orgs[0]))
  const claims = ok(await service.rpc('claim_outbound_events', { p_limit: 100, p_lease_seconds: 120 }))
  const first = claims.find(claim => claim.id === event.id)
  assert.ok(first)
  assert.equal(first.attempts, 1)
  ok(await service.from('outbound_events').update({ lease_expires_at: '2000-01-01T00:00:00Z' }).eq('id', event.id).eq('org_id', orgs[0]))
  const second = ok(await service.rpc('claim_outbound_events', { p_limit: 100, p_lease_seconds: 120 })).find(claim => claim.id === event.id)
  assert.ok(second)
  assert.notEqual(second.lease_token, first.lease_token)
  assert.equal(second.attempts, 2)
  assert.equal(ok(await service.rpc('finish_outbound_event', { p_event_id: event.id, p_lease_token: first.lease_token, p_error: null })), false)
  assert.equal(ok(await service.rpc('finish_outbound_event', { p_event_id: event.id, p_lease_token: second.lease_token, p_error: 'Local synthetic failure' })), true)
  const failed = ok(await service.from('outbound_events').select('status,next_attempt_at,delivered_at').eq('id', event.id).eq('org_id', orgs[0]).single())
  assert.equal(failed.status, 'failed')
  assert.equal(failed.delivered_at, null)
  assert.ok(new Date(failed.next_attempt_at).getTime() > Date.now())
})

test('authenticated integration receipts deduplicate atomically and reject changed payload', async () => {
  const args = { p_org_id: orgs[0], p_event_type: 'followup', p_key: randomUUID(), p_payload: { source: 'synthetic', value: 101 } }
  const results = (await Promise.all(Array.from({ length: 4 }, () => service.rpc('accept_integration_event', args)))).map(ok)
  assert.equal(new Set(results.map(result => result.eventId)).size, 1)
  assert.equal(results.filter(result => !result.duplicate).length, 1)
  assert.ok((await service.rpc('accept_integration_event', { ...args, p_payload: { ...args.p_payload, value: 102 } })).error)
  assert.deepEqual(ok(await service.rpc('accept_integration_event', args)), { eventId: results[0].eventId, duplicate: true })
})
