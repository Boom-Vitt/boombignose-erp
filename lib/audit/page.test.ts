import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { OrgContext } from "@/lib/auth"
import { requireOrgContext } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"
import { databaseFixture } from "@/lib/supabase/__tests__/tenant-fixture"
import AuditPage from "@/app/(app)/audit/page"

vi.mock("@/lib/auth", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/auth")>(),
  requireOrgContext: vi.fn(),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const context: OrgContext = {
  userId: "user-a",
  email: null,
  orgId: "org-a",
  orgName: "Workspace A",
  role: "member",
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(requireOrgContext).mockResolvedValue({ ...context })
  vi.mocked(createClient).mockResolvedValue(databaseFixture({
    audit_log: [
      { id: "entry-a", org_id: "org-a", entity: "deal", action: "created", summary: "ACTIVE_WORKSPACE_ACTIVITY", created_at: "2026-10-01T00:00:00Z" },
      { id: "entry-b", org_id: "org-b", entity: "deal", action: "created", summary: "OTHER_WORKSPACE_ACTIVITY", created_at: "2026-10-01T00:00:00Z" },
    ],
  }) as Awaited<ReturnType<typeof createClient>>)
})

describe("audit page access", () => {
  it("shows members a denied page with a Dashboard return link before reading audit data", async () => {
    const html = renderToStaticMarkup(await AuditPage())

    expect(html).toMatch(/<h1[^>]*>ไม่มีสิทธิ์เข้าถึง<\/h1>/)
    expect(html).toMatch(/<a[^>]*href="\/dashboard"[^>]*>กลับ Dashboard<\/a>/)
    expect(html).not.toContain("ACTIVE_WORKSPACE_ACTIVITY")
    expect(html).not.toContain("OTHER_WORKSPACE_ACTIVITY")
    expect(createClient).not.toHaveBeenCalled()
  })

  it.each(["owner", "admin"] as const)("lets %s view only the active workspace activity", async (role) => {
    vi.mocked(requireOrgContext).mockResolvedValue({ ...context, role })
    const html = renderToStaticMarkup(await AuditPage())

    expect(html).toMatch(/<h1[^>]*>Activity<\/h1>/)
    expect(html).toContain("ACTIVE_WORKSPACE_ACTIVITY")
    expect(html).not.toContain("OTHER_WORKSPACE_ACTIVITY")
    expect(html).not.toContain("ไม่มีสิทธิ์เข้าถึง")
  })

  it("preserves authentication failures instead of treating them as permission denials", async () => {
    vi.mocked(requireOrgContext).mockRejectedValue(new Error("REDIRECT:/login"))

    await expect(AuditPage()).rejects.toThrow("REDIRECT:/login")
    expect(createClient).not.toHaveBeenCalled()
  })
})
