#!/usr/bin/env node
/**
 * Verifies the local demo seed end-to-end:
 *   1. the demo user can log in,
 *   2. RLS lets that member READ the seeded org data (dashboard won't be empty),
 *   3. RLS BLOCKS an anonymous client from reading org data.
 *
 * Usage (from project root, local stack running):
 *   set -a; source .env.local; set +a; node scripts/verify-seed.mjs
 */
import { createClient } from "@supabase/supabase-js"

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY. Did you source .env.local?")
  process.exit(2)
}

const DEMO = { email: "demo@boombignose.org", password: "BoomDemo123!" }
let failures = 0
const check = (name, ok, extra = "") => {
  console.log(`${ok ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`)
  if (!ok) failures++
}

// 1) Demo login
const sb = createClient(url, anon)
const { data: s, error: e1 } = await sb.auth.signInWithPassword(DEMO)
check("demo login", !e1 && !!s?.user, e1?.message ?? s?.user?.email)

// 2) RLS lets the authenticated member read the seeded org data
const { data: deals, error: ed } = await sb.from("deals").select("id,stage,value_satang")
check("deals visible to member (>0)", (deals?.length ?? 0) > 0, ed?.message ?? `${deals?.length ?? 0} deals`)

const { count: clients } = await sb.from("clients").select("*", { count: "exact", head: true })
check("clients visible (>0)", (clients ?? 0) > 0, `${clients} clients`)

const { data: settings } = await sb.from("org_settings").select("cash_balance_satang").maybeSingle()
check("org cash settings present", !!settings, settings ? `${settings.cash_balance_satang} satang` : "none")

const { count: invoices } = await sb.from("invoices").select("*", { count: "exact", head: true })
const { count: templates } = await sb.from("automation_templates").select("*", { count: "exact", head: true })
const { count: projects } = await sb.from("projects").select("*", { count: "exact", head: true })
console.log(`  context: invoices=${invoices}, projects=${projects}, templates=${templates}`)

// 3) RLS blocks an anonymous (no-session) client
const anonSb = createClient(url, anon)
const { data: anonDeals } = await anonSb.from("deals").select("id")
check("anonymous sees 0 deals (RLS)", (anonDeals?.length ?? 0) === 0, `${anonDeals?.length ?? 0} rows`)

await sb.auth.signOut()
console.log(failures === 0 ? "\n✅ ALL CHECKS PASSED" : `\n❌ ${failures} CHECK(S) FAILED`)
process.exit(failures === 0 ? 0 : 1)
