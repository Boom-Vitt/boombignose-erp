import { beforeEach, describe, expect, it, vi } from "vitest"

const fixture = vi.hoisted(() => ({
  ctx: { orgId: "00000000-0000-4000-8000-000000000001", role: "owner" },
  rpc: vi.fn(),
  from: vi.fn(),
  writes: [] as Record<string, unknown>[],
  storedOwner: null as string | null,
}))
vi.mock("@/lib/auth", () => ({ requireOrgContext: async () => fixture.ctx }))
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: fixture.rpc, from: fixture.from }),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/navigation", () => ({
  redirect: (path: string) => { throw new Error(`redirect:${path}`) },
}))

import { createProject, updateProject } from "@/app/(app)/projects/actions"

const member = "00000000-0000-4000-8000-0000000000a1"
const outsider = "00000000-0000-4000-8000-0000000000b2"
const projectId = "00000000-0000-4000-8000-0000000000c3"
const base = { name: "Website", status: "not_started" as const }

beforeEach(() => {
  fixture.writes = []
  fixture.storedOwner = null
  fixture.rpc.mockReset().mockResolvedValue({ data: [{ user_id: member, full_name: "Member" }], error: null })
  fixture.from.mockReset().mockImplementation(() => {
    const chain = {
      insert: (row: Record<string, unknown>) => { fixture.writes.push(row); return chain },
      update: (row: Record<string, unknown>) => { fixture.writes.push(row); return chain },
      select: () => chain,
      eq: () => chain,
      single: async () => ({ data: { id: projectId }, error: null }),
      maybeSingle: async () => ({ data: { owner: fixture.storedOwner }, error: null }),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    }
    return chain
  })
})

describe("project owner", () => {
  it("saves a workspace member as the owner", async () => {
    await expect(createProject({ ...base, owner: member })).rejects.toThrow(`redirect:/projects/${projectId}`)
    expect(fixture.rpc).toHaveBeenCalledWith("record_activity_assignees", { p_org_id: fixture.ctx.orgId })
    expect(fixture.writes[0]).toMatchObject({ owner: member })
  })

  it("saves no owner without checking membership", async () => {
    await expect(createProject({ ...base, owner: "none" })).rejects.toThrow("redirect:")
    expect(fixture.writes[0]).toMatchObject({ owner: null })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it("rejects typed text before any database call", async () => {
    expect(await createProject({ ...base, owner: "Somchai" })).toEqual({ error: "Invalid input" })
    expect(fixture.from).not.toHaveBeenCalled()
  })

  it("rejects a user who is not in the workspace", async () => {
    expect(await createProject({ ...base, owner: outsider })).toEqual({ error: "Choose a team member as the owner." })
    expect(fixture.writes).toEqual([])
  })

  it("keeps an unchanged owner who has left the workspace", async () => {
    fixture.storedOwner = outsider
    await expect(updateProject({ ...base, id: projectId, owner: outsider })).rejects.toThrow(`redirect:/projects/${projectId}`)
    expect(fixture.writes[0]).toMatchObject({ owner: outsider })
    expect(fixture.rpc).not.toHaveBeenCalled()
  })

  it("rejects changing the owner to a user outside the workspace", async () => {
    fixture.storedOwner = member
    expect(await updateProject({ ...base, id: projectId, owner: outsider })).toEqual({ error: "Choose a team member as the owner." })
    expect(fixture.writes).toEqual([])
  })
})
