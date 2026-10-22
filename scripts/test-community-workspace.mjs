import assert from "node:assert/strict"
import { execFile } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { promisify } from "node:util"

const exec = promisify(execFile)
const name = `bbn-community-test-${randomUUID()}`
const actor = randomUUID()
const otherActor = randomUUID()
let checks = 0

async function docker(...args) {
  return (await exec("docker", args, { timeout: 60_000, maxBuffer: 1024 * 1024 })).stdout.trim()
}
async function sql(statement) {
  return docker("exec", name, "psql", "-X", "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-h", "127.0.0.1", "-Atq", "-c", statement)
}
function command(user, key, label = "Community workspace", rpc = "provision_workspace") {
  return `set role authenticated; set request.jwt.claim.sub='${user}'; select public.${rpc}('${label}','${key}');`
}
async function rejects(statement, pattern) {
  await assert.rejects(sql(statement), pattern)
  checks++
}
async function reset() {
  await sql("truncate public.organizations cascade; delete from public.workspace_requests;")
}

await docker("image", "inspect", "postgres:17")
await docker("run", "--rm", "--detach", "--name", name, "--network", "none", "--tmpfs", "/var/lib/postgresql/data", "--env", "POSTGRES_HOST_AUTH_METHOD=trust", "postgres:17")
try {
  let ready = false
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await sql("select 1"); ready = true; break } catch { await new Promise(resolve => setTimeout(resolve, 250)) }
  }
  assert.ok(ready, "Isolated PostgreSQL did not become ready")
  await sql(`
    create role authenticated; create role anon; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated,anon,service_role;
    create table public.organizations(id uuid primary key,name text,slug text unique);
    create table public.memberships(org_id uuid references public.organizations on delete cascade,user_id uuid,role text,primary key(user_id,org_id));
    create table public.org_settings(org_id uuid references public.organizations on delete cascade);
    create table public.audit_log(org_id uuid references public.organizations on delete cascade,actor_id uuid,entity text,entity_id uuid,action text,summary text);
    create table public.workspace_requests(user_id uuid,key uuid,name text,org_id uuid references public.organizations on delete cascade,primary key(user_id,key));
  `)
  await sql(await readFile("supabase/migrations/20261022090000_community_first_workspace.sql", "utf8"))
  await rejects(`set role anon; select public.provision_workspace('Workspace','${randomUUID()}');`, /permission denied/)
  await rejects(command(actor, randomUUID(), "   "), /Invalid workspace request/)

  const key = randomUUID()
  const same = await Promise.all([sql(command(actor, key)), sql(command(actor, key))])
  assert.equal(same[0], same[1]); checks++
  assert.equal(await sql("select count(*) from public.organizations"), "1"); checks++
  assert.equal(await sql(`select role from public.memberships where user_id='${actor}'`), "owner"); checks++
  await rejects(command(actor, key, "Changed name"), /Idempotency conflict/)
  await rejects(command(actor, randomUUID()), /already has a workspace/)
  await rejects(command(otherActor, randomUUID()), /already has a workspace/)
  assert.equal(await sql("select count(*) from public.workspace_requests"), "1"); checks++

  await reset()
  const differentKeys = await Promise.allSettled([sql(command(actor, randomUUID())), sql(command(actor, randomUUID()))])
  assert.equal(differentKeys.filter(result => result.status === "fulfilled").length, 1); checks++
  assert.equal(await sql("select count(*) from public.organizations"), "1"); checks++
  await reset()
  const differentActors = await Promise.allSettled([sql(command(actor, randomUUID())), sql(command(otherActor, randomUUID()))])
  assert.equal(differentActors.filter(result => result.status === "fulfilled").length, 1); checks++
  assert.equal(await sql("select count(*) from public.organizations"), "1"); checks++

  await reset()
  const retainedKey = randomUUID()
  await sql(command(actor, retainedKey))
  await sql("delete from public.memberships")
  await rejects(command(actor, retainedKey), /Workspace membership unavailable/)

  if (existsSync("ee/supabase/provision-hosted-workspace.sql")) {
    await sql(await readFile("ee/supabase/provision-hosted-workspace.sql", "utf8"))
    const proKey = randomUUID()
    const additional = await sql(command(actor, proKey, "Hosted workspace", "provision_hosted_workspace"))
    assert.equal(await sql(command(actor, proKey, "Hosted workspace", "provision_hosted_workspace")), additional); checks++
    assert.equal(await sql("select count(*) from public.organizations"), "2"); checks++
    await rejects(command(otherActor, randomUUID()), /already has a workspace/)
  }
  console.log(`PASS ${checks} PostgreSQL checks. Community singleton bootstrap, authentication, concurrency, retries, rollback and optional Pro provisioning.`)
} finally {
  await docker("rm", "--force", name)
}
