import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OrgContext } from "@/lib/auth"

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  requireOrgContext: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

import AuditPage from "@/app/(app)/audit/page"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

const context: OrgContext = {
  userId: "user-1",
  email: null,
  orgId: "org-1",
  orgName: "Test workspace",
  role: "member",
}

const query = {
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  order: vi.fn().mockReturnThis(),
  limit: vi.fn(),
}
const from = vi.fn(() => query)

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(requireOrgContext).mockResolvedValue(context)
  vi.mocked(createClient).mockResolvedValue({ from } as unknown as Awaited<ReturnType<typeof createClient>>)
  query.limit.mockResolvedValue({ data: [] })
})

describe("audit page access", () => {
  it("shows members an access-denied page with a Dashboard link without reading audit data", async () => {
    const html = renderToStaticMarkup(await AuditPage())

    expect(html).toContain("ไม่มีสิทธิ์เข้าถึง")
    expect(html).toContain("กลับ Dashboard")
    expect(html).toMatch(/<a\b[^>]*href="\/dashboard"[^>]*>/)
    expect(vi.mocked(createClient)).not.toHaveBeenCalled()
    expect(from).not.toHaveBeenCalled()
  })

  it.each(["owner", "admin"] as const)("shows %s the workspace audit feed", async (role) => {
    vi.mocked(requireOrgContext).mockResolvedValue({ ...context, role })
    query.limit.mockResolvedValue({ data: [{
      id: "entry-1", actor_email: null, entity: "deal", entity_id: "deal-1",
      action: "created", summary: "Created an audit test deal", created_at: new Date().toISOString(),
    }] })

    const html = renderToStaticMarkup(await AuditPage())

    expect(html).toContain("Activity")
    expect(html).toContain("Created an audit test deal")
    expect(html).not.toContain("ไม่มีสิทธิ์เข้าถึง")
    expect(from).toHaveBeenCalledWith("audit_log")
    expect(query.eq).toHaveBeenCalledWith("org_id", context.orgId)
    expect(query.order).toHaveBeenCalledWith("created_at", { ascending: false })
    expect(query.limit).toHaveBeenCalledWith(100)
  })

  it("preserves authentication and workspace errors", async () => {
    const error = new Error("Workspace unavailable")
    vi.mocked(requireOrgContext).mockRejectedValueOnce(error)

    await expect(AuditPage()).rejects.toBe(error)
    expect(vi.mocked(createClient)).not.toHaveBeenCalled()
  })
})
