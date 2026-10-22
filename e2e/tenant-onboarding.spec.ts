import { test as base, expect, type Page } from "@playwright/test"
import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { randomUUID } from "node:crypto"
import { readFileSync } from "node:fs"
import { community } from "./edition"

const isolation = JSON.parse(readFileSync(".local-stack/isolation.json", "utf8"))
const env = Object.fromEntries(readFileSync(".env.local", "utf8").trim().split("\n").filter(line => line.includes("=")).map(line => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]))
const baseURL = `http://127.0.0.1:${isolation.app}`
if (env.NEXT_PUBLIC_SUPABASE_URL !== `http://127.0.0.1:${isolation.api}`) throw new Error("Tenant fixtures require this worktree's isolated local API")
const options = { auth: { persistSession: false, autoRefreshToken: false } }
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, options)

type Actor = { id: string; email: string; password: string; api: SupabaseClient }
type Workspace = { id: string; name: string }

function ok<T extends { data: unknown; error: { message: string } | null }>(response: T): NonNullable<T["data"]> {
  expect(response.error, response.error?.message).toBeNull()
  if (response.data == null) throw new Error("Expected local fixture result")
  return response.data as NonNullable<T["data"]>
}

class Fixtures {
  readonly run = randomUUID()
  readonly users: Actor[] = []
  readonly workspaces = new Set<string>()
  readonly workspaceNames = new Set<string>()
  private readonly startedAt = Date.now()

  constructor(readonly page: Page) {}

  name(label: string) { return `QA ${label} ${this.run}` }

  async user(): Promise<Actor> {
    const email = `qa-${randomUUID()}@example.invalid`
    const password = `Local-${randomUUID()}!`
    const created = ok(await admin.auth.admin.createUser({ email, password, email_confirm: true }))
    if (!created.user) throw new Error("Expected synthetic user")
    const api = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
    const actor = { id: created.user.id, email, password, api }
    this.users.push(actor)
    ok(await api.auth.signInWithPassword({ email, password }))
    return actor
  }

  async workspace(label: string, owner: Actor): Promise<Workspace> {
    const workspace = { id: randomUUID(), name: this.name(label) }
    this.workspaces.add(workspace.id)
    this.workspaceNames.add(workspace.name)
    expect((await admin.from("organizations").insert({ ...workspace, slug: `qa-${workspace.id}` })).error).toBeNull()
    expect((await admin.from("memberships").insert({ org_id: workspace.id, user_id: owner.id, role: "owner", created_at: new Date(this.startedAt + this.workspaces.size).toISOString() })).error).toBeNull()
    return workspace
  }

  async signIn(actor: Actor, navigate = true) {
    if (navigate) await this.page.goto("/login")
    await this.page.getByLabel("Email", { exact: true }).fill(actor.email)
    await this.page.getByLabel("Password", { exact: true }).fill(actor.password)
    await this.page.getByRole("button", { name: "Sign in", exact: true }).click()
    await this.page.waitForURL(/\/(dashboard|onboarding|invite\/[^/]+)(?:\?.*)?$/)
  }

  async cleanup() {
    // Discover only this test's uniquely named UI-created workspaces, not every
    // membership: a failed authorization test must never delete an unrelated org.
    if (this.workspaceNames.size) {
      const rows = ok(await admin.from("organizations").select("id").in("name", [...this.workspaceNames]))
      for (const row of rows) this.workspaces.add(row.id)
    }
    for (const id of this.workspaces) expect((await admin.from("organizations").delete().eq("id", id)).error).toBeNull()
    for (const actor of this.users) expect((await admin.auth.admin.deleteUser(actor.id)).error).toBeNull()
  }
}

const test = base.extend<{ fixtures: Fixtures }>({
  fixtures: async ({ page }, provide) => {
    const fixtures = new Fixtures(page)
    try { await provide(fixtures) } finally { await fixtures.cleanup() }
  },
})

test("switching two actual memberships fences dashboard, clients, deals and exports", async ({ fixtures: f, page, context }) => {
  test.skip(community, "The workspace switcher is Pro-only (BBN_EDITION=pro)")
  page.on("pageerror", error => console.error("QA switcher client error:", error.stack ?? error.message))
  const actor = await f.user()
  const a = await f.workspace("workspace A", actor)
  const b = await f.workspace("workspace B", actor)
  const clients = []
  for (const [workspace, label, amount] of [[a, "client A", 123400], [b, "client B", 567800]] as const) {
    const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name(label) }).select("id, name").single())
    clients.push(client)
    expect((await admin.from("deals").insert({ org_id: workspace.id, client_id: client.id, title: f.name(`deal ${label.at(-1)}`), value_satang: amount, stage: "lead" })).error).toBeNull()
  }
  const [clientA, clientB] = clients
  const pipeline = page.locator('[data-slot="card"]').filter({ has: page.getByText("Open pipeline", { exact: true }) })
  await f.signIn(actor)
  await expect(pipeline.getByText("฿1,234", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toHaveCount(0)
  await page.goto("/deals")
  await expect(page.getByText(f.name("deal A"), { exact: true })).toBeVisible()
  await expect(page.getByText(f.name("deal B"), { exact: true })).toHaveCount(0)

  await page.getByRole("button", { name: new RegExp(a.name) }).click()
  await page.getByRole("menuitem", { name: b.name, exact: true }).click()
  await expect.poll(async () => (await context.cookies(baseURL)).find(cookie => cookie.name === "active_org")?.value).toBe(b.id)
  await expect(pipeline.getByText("฿5,678", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toHaveCount(0)
  await page.goto(`/clients/${clientA.id}`)
  await expect(page.getByRole("heading", { name: "404", exact: true })).toBeVisible()
  await page.goto("/deals")
  await expect(page.getByText(f.name("deal B"), { exact: true })).toBeVisible()
  await expect(page.getByText(f.name("deal A"), { exact: true })).toHaveCount(0)
  const exported = await page.request.get("/deals/export")
  expect(exported.status()).toBe(200)
  const csv = await exported.text()
  expect(csv).toContain(f.name("deal B"))
  expect(csv).not.toContain(f.name("deal A"))

  await context.addCookies([{ name: "active_org", value: randomUUID(), url: baseURL, httpOnly: true, sameSite: "Lax" }])
  await page.goto("/dashboard")
  await expect(pipeline.getByText("฿1,234", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page.getByRole("link", { name: clientA.name, exact: true })).toBeVisible()
  await expect(page.getByRole("link", { name: clientB.name, exact: true })).toHaveCount(0)
})

test("a zero-membership account reaches onboarding and provisions one owner workspace", async ({ fixtures: f, page, context }) => {
  test.skip(community, "Provisioning an additional workspace is Pro-only (BBN_EDITION=pro)")
  const actor = await f.user()
  expect(ok(await admin.from("memberships").select("id").eq("user_id", actor.id))).toHaveLength(0)
  await f.signIn(actor)
  await expect(page).toHaveURL(/\/onboarding$/)
  await expect(page.getByText("Create your workspace / สร้างพื้นที่ทำงาน", { exact: true })).toBeVisible()
  await page.goto("/clients")
  await expect(page).toHaveURL(/\/onboarding$/)
  const name = f.name("provisioned workspace")
  f.workspaceNames.add(name)
  await page.locator("#workspace-name").fill(name)
  await page.getByRole("button", { name: /^Create workspace/ }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const memberships = ok(await admin.from("memberships").select("org_id, role").eq("user_id", actor.id))
  expect(memberships).toHaveLength(1)
  expect(memberships[0].role).toBe("owner")
  expect(ok(await admin.from("organizations").select("name").eq("id", memberships[0].org_id).single()).name).toBe(name)
  f.workspaces.add(memberships[0].org_id)
  const activeCookie = (await context.cookies()).find(cookie => cookie.name === "active_org")
  console.info("QA active cookie metadata:", JSON.stringify({ present: !!activeCookie, secure: activeCookie?.secure, domain: activeCookie?.domain, path: activeCookie?.path, appURL: baseURL }))
  expect((await context.cookies(baseURL)).find(cookie => cookie.name === "active_org")?.value).toBe(memberships[0].org_id)
})

test("invitation account switching accepts only the intended recipient and retry preserves one membership", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const recipient = await f.user()
  const wrong = await f.user()
  const workspace = await f.workspace("invited workspace", owner)
  const token = randomUUID().replaceAll("-", "")
  const invite = ok(await admin.from("invitations").insert({ org_id: workspace.id, email: recipient.email, role: "member", token, invited_by: owner.id, expires_at: new Date(Date.now() + 86400000).toISOString() }).select("id").single())
  await f.signIn(wrong)
  await page.goto(`/invite/${token}`)
  await expect(page.getByText("Invitation unavailable", { exact: true })).toBeVisible()
  await expect(page.getByText(workspace.name, { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Accept invitation", exact: true })).toHaveCount(0)
  expect((await wrong.api.rpc("accept_workspace_invitation", { p_token: token })).error).not.toBeNull()
  expect(ok(await admin.from("memberships").select("id").eq("user_id", wrong.id))).toHaveLength(0)
  expect(ok(await admin.from("invitations").select("status").eq("id", invite.id).single()).status).toBe("pending")
  await page.getByRole("button", { name: "Use another account", exact: true }).click()
  await expect(page).toHaveURL(/\/login\?redirect=/)
  await f.signIn(recipient, false)
  await expect(page).toHaveURL(new RegExp(`/invite/${token}$`))
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const accepted = ok(await admin.from("invitations").select("status, accepted_by").eq("id", invite.id).single())
  expect(accepted).toEqual({ status: "accepted", accepted_by: recipient.id })
  await page.goto(`/invite/${token}`)
  await page.getByRole("button", { name: "Accept invitation", exact: true }).click()
  await expect(page).toHaveURL(/\/dashboard$/)
  const memberships = ok(await admin.from("memberships").select("role").eq("org_id", workspace.id).eq("user_id", recipient.id))
  expect(memberships).toEqual([{ role: "member" }])
})

test("a committed subscription request survives lost response, reload and status refresh without billing the next occurrence", async ({ fixtures: f, page }) => {
  const owner = await f.user()
  const workspace = await f.workspace("subscription recovery", owner)
  const client = ok(await admin.from("clients").insert({ org_id: workspace.id, name: f.name("subscription client") }).select("id").single())
  const subscription = ok(await admin.from("subscriptions").insert({ org_id: workspace.id, client_id: client.id, name: f.name("weekly subscription"), amount_satang: 10000, interval: "weekly", start_date: "2026-07-02", next_run_date: "2026-07-02", status: "active" }).select("id, name").single())
  await f.signIn(owner)
  await page.goto(`/finance/subscriptions/${subscription.id}`)
  let dropResponse = true
  await page.route("**/*", async route => {
    if (dropResponse && route.request().method() === "POST" && route.request().headers()["next-action"]) {
      dropResponse = false
      await route.fetch() // Commit the scheduled occurrence before dropping its response.
      await route.abort("failed")
    } else await route.continue()
  })
  const receipts = async () => ok(await admin.from("invoices").select("id").eq("org_id", workspace.id))
  const nextRun = async () => ok(await admin.from("subscriptions").select("next_run_date").eq("id", subscription.id).single()).next_run_date
  await page.getByRole("button", { name: "Generate scheduled invoice", exact: true }).click()
  await expect(page.getByText("Could not confirm the invoice request. Retry in this tab.", { exact: true })).toBeVisible()
  await expect.poll(async () => (await receipts()).length).toBe(1)
  expect(await nextRun()).toBe("2026-07-09")
  const originalInvoice = (await receipts())[0].id

  await page.reload()
  const retry = page.getByRole("button", { name: "Retry invoice for 2026-07-02", exact: true })
  await expect(retry).toBeVisible()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByRole("button", { name: "Activate", exact: true }).click()
  await expect(retry).toBeEnabled()
  await retry.click()
  await expect(page.getByRole("button", { name: "Generate scheduled invoice", exact: true })).toBeVisible()
  expect(await receipts()).toEqual([{ id: originalInvoice }])
  expect(await nextRun()).toBe("2026-07-09")

  // Only a new acknowledged user command may bill the still-overdue July 9 slot.
  await page.getByRole("button", { name: "Generate scheduled invoice", exact: true }).click()
  await expect.poll(async () => (await receipts()).length).toBe(2)
  expect(await nextRun()).toBe("2026-07-16")
})
